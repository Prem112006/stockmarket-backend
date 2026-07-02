const { spawn } = require('child_process');
const path = require('path');

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

exports.getMarketSentiment = async (req, res, next) => {
  try {
    console.log('Market Sentiment prediction requested');
    
    const pythonScript = path.join(__dirname, '..', 'market_sentiment.py');
    const pythonProcess = spawn(PYTHON_PATH, [pythonScript]);

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error('Python Error (Sentiment):', errorString);
        return res.status(502).json({
          message: 'Failed to generate market sentiment',
          details: 'Python execution failed',
          pythonError: errorString.trim().slice(0, 180)
        });
      }

      try {
        const result = JSON.parse(dataString);

        if (result.error) {
          return res.status(502).json({
            message: result.error,
            details: result.message || 'Market sentiment failed'
          });
        }

        return res.json({
          message: 'Market sentiment analyzed successfully',
          ...result
        });

      } catch (parseError) {
        console.error('Parse Error (Sentiment):', parseError);
        console.error('Python Output (Sentiment):', dataString);
        return res.status(500).json({
          message: 'Failed to parse market sentiment results',
          details: parseError.message
        });
      }
    });

  } catch (err) {
    return next(err);
  }
};
