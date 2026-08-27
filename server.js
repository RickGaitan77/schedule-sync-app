const express = require('express');
const cors = require('cors');
const path = require('path');
const Tesseract = require('tesseract.js');
const ical = require('ical-generator').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper function to extract schedule entries from raw OCR text
function parseShiftsFromText(text) {
    const shifts = [];
    const lines = text.split('\n');
    
    // Basic regex or text pattern matching for shifts and dates
    lines.forEach((line) => {
        const lower = line.toLowerCase();
        let shiftType = null;
        let colorCode = "light-blue";

        if (lower.includes('surgery') || lower.includes('surg')) {
            shiftType = "Surgery";
            colorCode = "red";
        } else if (lower.includes('urgent') || lower.includes('uc')) {
            shiftType = "Urgent Care";
            colorCode = "yellow";
        } else if (lower.includes('room') || lower.includes('exam')) {
            shiftType = "Rooms";
            colorCode = "dark-blue";
        }

        if (shiftType) {
            shifts.push({
                shiftType,
                colorCode,
                details: line.trim(),
                date: new Date().toISOString() // Fallback or parsed date
            });
        }
    });

    // If no specific keywords matched, return a general record with the raw text snippet
    if (shifts.length === 0 && text.trim().length > 0) {
        shifts.push({
            shiftType: "General Shift",
            colorCode: "light-blue",
            details: text.substring(0, 60) + '...',
            date: new Date().toISOString()
        });
    }

    return shifts;
}

app.post('/api/parse-schedule', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, error: 'No image provided' });
        }

        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const { data: { text } } = await Tesseract.recognize(
            imageBuffer,
            'eng',
            { logger: () => {} }
        );

        const detectedShifts = parseShiftsFromText(text || '');

        res.json({
            success: true,
            rawText: text,
            shifts: detectedShifts
        });

    } catch (error) {
        console.error('OCR Parsing Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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