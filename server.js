const express = require('express');
const cors = require('cors');
const path = require('path');
const ical = require('ical-generator').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Schedule Parsing Route using direct Google Vision REST API (uses GOOGLE_API_KEY securely)
app.post('/api/parse-schedule', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, error: 'No image provided' });
        }

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'GOOGLE_API_KEY is not configured on the server.' });
        }

        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        // Call Google Vision REST API directly
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
        const visionBody = {
            requests: [
                {
                    image: { content: base64Data },
                    features: [{ type: 'TEXT_DETECTION' }]
                }
            ]
        };

        const visionResponse = await fetch(visionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(visionBody)
        });

        const visionData = await visionResponse.json();
        
        if (visionData.error) {
            throw new Error(visionData.error.message || 'Google Vision API error');
        }

        const annotations = visionData.responses?.[0]?.textAnnotations;
        const fullText = annotations && annotations.length > 0 ? annotations[0].description : '';

        // Classification logic
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
            shifts.forEach((shift) => {
                calendar.createEvent({
                    start: new Date(shift.date || Date.now()),
                    end: new Date(new Date(shift.date || Date.now()).getTime() + 8 * 3600000),
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