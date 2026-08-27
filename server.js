const express = require('express');
const cors = require('cors');
const path = require('path');
const vision = require('@google-cloud/vision');
const ical = require('ical-generator').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files (like index.html)
app.use(express.static(path.join(__dirname)));

// Initialize Google Cloud Vision Client
// On Render, it reads from the GOOGLE_API_KEY environment variable automatically
const client = new vision.ImageAnnotatorClient();

// Schedule Parsing Route (OCR + Classification)
app.post('/api/parse-schedule', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, error: 'No image provided' });
        }

        // Remove the data URL prefix if present (e.g., "data:image/jpeg;base64,...")
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Call Google Cloud Vision API for Text Detection
        const [result] = await client.textDetection({ image: { content: imageBuffer } });
        const detections = result.textAnnotations;
        const fullText = detections && detections.length > 0 ? detections[0].description : '';

        // Simple classification logic based on detected text keywords
        let shiftType = "General Shift";
        let colorCode = "light-blue";

        const lowerText = fullText.toLowerCase();
        if (lowerText.includes('surgery') || lowerText.includes('surg')) {
            shiftType = "Surgery";
            colorCode = "red";
        } else if (lowerText.includes('urgent') || lowerText.includes('uc')) {
            shiftType = "Urgent Care";
            colorCode = "yellow";
        } else if (lowerText.includes('room') || lowerText.includes('exam')) {
            shiftType = "Rooms";
            colorCode = "dark-blue";
        }

        res.json({
            success: true,
            rawText: fullText,
            shiftClassification: {
                shiftType,
                colorCode
            }
        });

    } catch (error) {
        console.error('OCR Parsing Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Calendar Export Route (.ics generation)
app.post('/api/export-calendar', (req, res) => {
    try {
        const { shifts } = req.body;
        const calendar = ical({ name: 'Work Schedule' });

        if (shifts && Array.isArray(shifts)) {
            shifts.forEach((shift, index) => {
                calendar.createEvent({
                    start: new Date(shift.date || Date.now()),
                    end: new Date(new Date(shift.date || Date.now()).getTime() + 8 * 3600000), // Default 8 hour block
                    summary: `Work: ${shift.shiftType}`,
                    description: shift.details || 'Parsed via Schedule Sync OCR',
                });
            });
        }

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="work-schedule.ics"');
        res.send(calendar.toString());

    } catch (error) {
        console.error('Calendar Export Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});