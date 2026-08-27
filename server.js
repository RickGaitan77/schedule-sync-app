const express = require('express');
const cors = require('cors');
const vision = require('@google-cloud/vision');
const ical = require('ical-generator').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const visionClient = new vision.ImageAnnotatorClient({
    keyApiKey: process.env.GOOGLE_API_KEY
});

app.get('/', (req, res) => {
    res.json({ message: "Schedule Sync API is running!" });
});

// Helper to classify colors into your department keys
function classifyColorByRGB(red, green, blue) {
    if (red > 150 && green < 100 && blue < 100) return { type: 'Surgery', code: 'red' };
    if (red > 180 && green > 150 && blue < 100) return { type: 'Drop-Off', code: 'yellow' };
    if (blue > 120 && red < 80 && green < 120) return { type: 'Urgent Care', code: 'dark-blue' };
    return { type: 'Room Shift', code: 'light-blue' };
}

// OCR Parsing Route
app.post('/api/parse-schedule', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        
        if (!imageBase64) {
            return res.status(400).json({ error: "No image data provided." });
        }

        const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), 'base64');

        const [textResult] = await visionClient.textDetection({ image: { content: imageBuffer } });
        const [propResult] = await visionClient.imageProperties({ image: { content: imageBuffer } });

        const extractedText = textResult.textAnnotations?.[0]?.description || "";
        const dominantColors = propResult.imagePropertiesAnnotation?.dominantColors?.colors || [];

        let detectedShiftType = 'Room Shift';
        let detectedColorCode = 'light-blue';

        if (dominantColors.length > 0) {
            const topColor = dominantColors[0].color;
            const classification = classifyColorByRGB(topColor.red || 0, topColor.green || 0, topColor.blue || 0);
            detectedShiftType = classification.type;
            detectedColorCode = classification.code;
        }

        res.json({ 
            success: true, 
            rawText: extractedText,
            shiftClassification: {
                shiftType: detectedShiftType,
                colorCode: detectedColorCode
            }
        });

    } catch (error) {
        console.error("OCR Error:", error);
        res.status(500).json({ error: "Failed to process image.", details: error.message });
    }
});

// Calendar Export Route (Generates an .ics file for Apple Calendar)
app.post('/api/export-calendar', (req, res) => {
    try {
        const { shifts } = req.body; // Expects an array of shift objects
        
        const calendar = ical({ name: 'Work Schedule - Apple Sync' });

        if (shifts && Array.isArray(shifts)) {
            shifts.forEach((shift, index) => {
                calendar.createEvent({
                    start: new Date(shift.date || Date.now()),
                    end: new Date(shift.endDate || Date.now() + 8 * 3600 * 1000), // Default 8-hour shift block
                    summary: `${shift.shiftType} (${shift.details || 'Work Shift'})`,
                    description: `Department shift parsed automatically. Code: ${shift.colorCode}`,
                    location: 'Workplace'
                });
            });
        }

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="work-schedule.ics"');
        res.send(calendar.toString());

    } catch (error) {
        console.error("Calendar Export Error:", error);
        res.status(500).json({ error: "Failed to generate calendar file." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});