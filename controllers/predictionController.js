const { validationResult } = require('express-validator');
const { spawn } = require('child_process');
const path = require('path');
const Stock = require('../models/Stock');
const { generateChartImage } = require('../generateChart');

const normalizeSymbol = (symbol) => String(symbol || '').trim().toUpperCase();

// Use absolute Python path to ensure it resolves correctly from Node.js spawn context
const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

exports.predictNextDay = async (req, res, next) => {
  try {
    console.log('Prediction request for symbol:', req.params.symbol);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const symbol = normalizeSymbol(req.params.symbol);

    const model = (req.query.model || 'lstm').toLowerCase();
    let pythonScript;
    if (model === 'finbert' || model === 'finbert+price' || model === 'finbert_price') {
      pythonScript = path.join(__dirname, '..', 'finbert_price_predict.py');
    } else if (model === 'random_forest' || model === 'random forest') {
      pythonScript = path.join(__dirname, '..', 'random_forest_predict.py');
    } else {
      pythonScript = path.join(__dirname, '..', 'lstm_predict.py');
    }
    const pythonProcess = spawn(PYTHON_PATH, [pythonScript, symbol], {
      env: {
        ...process.env,
        TF_ENABLE_ONEDNN_OPTS: '0',
        TF_CPP_MIN_LOG_LEVEL: '3',   // Suppress TF C++ logs
        PYTHONUNBUFFERED: '1'
      }
    });

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      // Try to parse stdout first — TF/sklearn print warnings to stderr
      // which can cause non-zero exit codes in some environments even on success
      let parsedEarly = null;
      if (dataString.trim()) {
        try { parsedEarly = JSON.parse(dataString); } catch (_) { }
      }

      if (code !== 0 && !parsedEarly) {
        console.error('Python Error (exit code ' + code + '):', errorString);
        return res.status(502).json({
          message: 'Failed to generate prediction',
          details: 'ML model execution failed',
          pythonError: errorString.trim().slice(0, 400)
        });
      }

      if (code !== 0 && parsedEarly) {
        console.warn('Python exited with code', code, 'but stdout has valid JSON — continuing. stderr:', errorString.slice(0, 200));
      }

      try {
        const result = parsedEarly || JSON.parse(dataString);

        if (result.error) {
          return res.status(502).json({
            message: result.error,
            details: result.message || 'Prediction failed'
          });
        }

        // Update Stock in DB
        await Stock.findOneAndUpdate(
          { symbol: result.symbol },
          {
            symbol: result.symbol,
            name: result.name,
            currentPrice: result.currentPrice,
            currency: result.currency
          },
          { upsert: true }
        );

        // Generate matplotlib chart
        let chartImage = '';
        try {
          chartImage = await generateChartImage(result);
        } catch (chartError) {
          console.error('Chart generation failed:', chartError.message);
          // Continue without chart if generation fails
        }

        return res.json({
          message: 'Prediction generated',
          ...result,
          chartImage: chartImage ? `data:image/png;base64,${chartImage}` : ''
        });

      } catch (parseError) {
        console.error('Parse Error:', parseError);
        console.error('Python Output:', dataString);
        return res.status(500).json({
          message: 'Failed to parse prediction results',
          details: parseError.message
        });
      }
    });

  } catch (err) {
    return next(err);
  }
};
