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

// Smart Shift Matcher: maps recognized text patterns to your exact clinic shift hours
function parseCalendarGrid(text, targetYear, targetMonth) {
    const shifts = [];
    const lines = text.split('\n');
    const dayNumberRegex = /\b([1-3]?[0-9])\b/;

    let lastFoundDay = null;

    lines.forEach((line) => {
        const cleaned = line.trim();
        if (!cleaned) return;

        // Capture the calendar day number
        const dayMatch = cleaned.match(dayNumberRegex);
        if (dayMatch) {
            const num = parseInt(dayMatch[1], 10);
            if (num >= 1 && num <= 31) {
                lastFoundDay = num;
            }
        }

        // Check for shift indicators or text inside the cell
        const lowerText = cleaned.toLowerCase();
        
        // Look for keywords or known shift time cues in the line
        if (lastFoundDay !== null && (lowerText.includes('7') || lowerText.includes('12') || lowerText.includes('1') || lowerText.includes('2') || lowerText.includes('6') || lowerText.includes('10') || lowerText.includes('shift') || lowerText.includes('urgent'))) {
            
            let shiftType = "General Shift";
            let colorCode = "light-blue";
            let startTimeText = "7:00 AM";
            let endTimeText = "6:00 PM";
            let details = "7:00 AM to 6:00 PM";

            // Determine shift variations based on text clues
            if (lowerText.includes('12p') || lowerText.includes('10p') || lowerText.includes('urgent')) {
                shiftType = "Urgent Care";
                colorCode = "dark-blue";
                startTimeText = "12:00 PM";
                endTimeText = "10:00 PM";
                details = "12:00 PM to 10:00 PM";
            } else if (lowerText.includes('12') && lowerText.includes('1')) {
                startTimeText = "12:00 PM";
                endTimeText = "1:00 PM";
                details = "12:00 PM to 1:00 PM";
            } else if (lowerText.includes('1') && lowerText.includes('6')) {
                startTimeText = "1:00 PM";
                endTimeText = "6:00 PM";
                details = "1:00 PM to 6:00 PM";
            } else if (lowerText.includes('2') && lowerText.includes('6')) {
                startTimeText = "2:00 PM";
                endTimeText = "6:00 PM";
                details = "2:00 PM to 6:00 PM";
            }

            const shiftDate = new Date(targetYear, targetMonth, lastFoundDay);

            // Ensure we only record one shift per day
            const existingIndex = shifts.findIndex(s => new Date(s.date).getDate() === lastFoundDay);
            if (existingIndex === -1) {
                shifts.push({
                    shiftType,
                    colorCode,
                    details,
                    date: shiftDate.toISOString(),
                    startTimeText,
                    endTimeText
                });
            }
        }
    });

    shifts.sort((a, b) => new Date(a.date) - new Date(b.date));
    return shifts;
}

// Convert time strings into hours (0-23) for calendar export
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