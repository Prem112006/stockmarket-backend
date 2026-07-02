const { spawn } = require('child_process');
const path = require('path');

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

const generateChartImage = (predictionData) => {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'generate_chart.py');
    
    // Pass data as JSON to Python script
    const pythonProcess = spawn(PYTHON_PATH, [pythonScript]);
    
    let imageData = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      imageData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('Chart generation error:', errorString);
        reject(new Error('Failed to generate chart'));
        return;
      }

      try {
        // Parse base64 image from Python
        resolve(imageData.trim());
      } catch (err) {
        reject(err);
      }
    });

    // Send prediction data as JSON to Python stdin
    pythonProcess.stdin.write(JSON.stringify(predictionData));
    pythonProcess.stdin.end();
  });
};

module.exports = { generateChartImage };
