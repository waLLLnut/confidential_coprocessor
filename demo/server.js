const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo-enhanced.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Demo server running at http://localhost:${PORT}`);
  console.log('Open your browser and navigate to the URL above');
});