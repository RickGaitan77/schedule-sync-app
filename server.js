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

// Robust sequential grid parser: collects all days and shifts in order and pairs them up
function parseCalendarGrid(text, targetYear, targetMonth) {
    const shifts = [];
    const lines = text.split('\n');

    // Regex to match time blocks like "7a - 6p", "12p - 10p", "7:30a - 6p"
    const shiftTimeRegex = /(\d{1,2}(?::\d{2})?\s*[ap])\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap])/i;
    
    let foundDays = [];
    let foundShifts = [];

    lines.forEach((line) => {
        const cleaned = line.trim();
        if (!cleaned) return;

        // Capture standalone day numbers (1-31) representing calendar cells
        if (/^\b([1-2]?[0-9]|3[0-1])\b$/.test(cleaned)) {
            const dayNum = parseInt(cleaned, 10);
            if (!foundDays.includes(dayNum)) {
                foundDays.push(dayNum);
            }
        }

        // Capture shift time ranges
        const timeMatch = cleaned.match(shiftTimeRegex);
        if (timeMatch) {
            let shiftType = "General Shift";
            let colorCode = "light-blue";
            const lowerTime = cleaned.toLowerCase();

            if (lowerTime.includes('12p') || lowerTime.includes('10p')) {
                shiftType = "Urgent Care";
                colorCode = "dark-blue";
            }

            foundShifts.push({
                shiftType,
                colorCode,
                details: `${timeMatch[1]} to ${timeMatch[2]}`,
                startTimeText: timeMatch[1],
                endTimeText: timeMatch[2]
            });
        }
    });

    // Sequentially map each shift to its corresponding day number in order
    for (let i = 0; i < Math.min(foundShifts.length, foundDays.length); i++) {
        const day = foundDays[i];
        const shift = foundShifts[i];

        const shiftDate = new Date(targetYear, targetMonth, day);

        shifts.push({
            shiftType: shift.shiftType,
            colorCode: shift.colorCode,
            details: shift.details,
            date: shiftDate.toISOString(),
            startTimeText: shift.startTimeText,
            endTimeText: shift.endTimeText
        });
    }

    return shifts;
}

// Convert shorthand time strings like "7a" or "10p" into hours (0-23)
function parseTimeStringToHours(timeStr) {
    const clean = timeStr.toLowerCase().replace(/\s+/g, '');
    let isPM = clean.includes('p');
    let parts = clean.replace(/[ap]/g, '').split(':');
    let hours = parseInt(parts[0], 10);
    let minutes = parts[1] ? parseInt(parts[1], 10) : 0;

    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    return { hours, minutes };
}

app.post('/api/parse-schedule', async (req, res) => {
    try {
        const { imageBase64, year, month } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, error: 'No image provided' });
        }

        const targetYear = year !== undefined ? parseInt(year, 10) : new Date().getFullYear();
        const targetMonth = month !== undefined ? parseInt(month, 10) : new Date().getMonth();

        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const { data: { text } } = await Tesseract.recognize(
            imageBuffer,
            'eng',
            { logger: () => {} }
        );

        const detectedShifts = parseCalendarGrid(text || '', targetYear, targetMonth);

        res.json({
            success: true,
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
                const startDate = new Date(shift.date);
                const endDate = new Date(shift.date);

                if (shift.startTimeText && shift.endTimeText) {
                    const startParsed = parseTimeStringToHours(shift.startTimeText);
                    const endParsed = parseTimeStringToHours(shift.endTimeText);

                    startDate.setHours(startParsed.hours, startParsed.minutes, 0, 0);
                    endDate.setHours(endParsed.hours, endParsed.minutes, 0, 0);

                    if (endDate <= startDate) {
                        endDate.setDate(endDate.getDate() + 1);
                    }
                } else {
                    endDate.setHours(startDate.getHours() + 8);
                }

                calendar.createEvent({
                    start: startDate,
                    end: endDate,
                    summary: `Work: ${shift.shiftType}`,
                    description: `Shift hours: ${shift.details}`,
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