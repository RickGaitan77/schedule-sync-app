const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ical = require('ical-generator').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_FILE = path.join(__dirname, 'saved-schedule.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper: Convert time strings into hours/minutes
function parseTimeStringToHours(timeStr) {
    const clean = timeStr.toLowerCase().replace(/\s+/g, '');
    let isPM = clean.includes('pm') || clean.includes('p');
    let parts = clean.replace(/[apm]/g, '').split(':');
    let hours = parseInt(parts[0], 10);
    let minutes = parts[1] ? parseInt(parts[1], 10) : 0;

    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    return { hours, minutes };
}

// Get saved shifts from server storage
app.get('/api/get-schedule', (req, res) => {
    try {
        if (fs.existsSync(STORAGE_FILE)) {
            const data = fs.readFileSync(STORAGE_FILE, 'utf8');
            res.json({ success: true, shifts: JSON.parse(data) });
        } else {
            res.json({ success: true, shifts: [] });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route using global pattern matching to extract ALL shifts from continuous text
app.post('/api/parse-voice', (req, res) => {
    try {
        const { text, year, month } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: 'No text provided' });
        }

        const targetYear = year !== undefined ? parseInt(year, 10) : 2026;
        const targetMonth = month !== undefined ? parseInt(month, 10) : 7;

        let existingShifts = [];
        if (fs.existsSync(STORAGE_FILE)) {
            try { existingShifts = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8')); } catch(e) {}
        }

        const lowerText = text.toLowerCase();

        // Split text dynamically wherever a new date/day reference appears in the continuous stream
        // This looks for words like "on", "the", or day numbers to break up continuous dictation safely
        const segments = lowerText.split(/(?=\b(?:on\s+the|the|[0-9]{1,2}(?:st|nd|rd|th)?)\b)/g);

        segments.forEach(segment => {
            const lower = segment.trim();
            if (!lower) return;

            // Must contain a time range indicator ("to" or "-")
            if (!lower.includes('to') && !lower.includes('-')) return;

            // Extract day number
            const dayMatch = lower.match(/\b([1-3]?[0-9])(?:st|nd|rd|th)?\b/);
            if (!dayMatch) return;

            const dayNum = parseInt(dayMatch[1], 10);
            if (dayNum < 1 || dayNum > 31) return;

            let shiftType = "General Shift";
            let colorCode = "light-blue";
            let startTimeText = "7:00 AM";
            let endTimeText = "6:00 PM";
            let details = "7:00 AM to 6:00 PM";

            if (lower.includes('urgent') || lower.includes('urgent care') || lower.includes('12 to 10') || lower.includes('12p')) {
                shiftType = "Urgent Care";
                colorCode = "dark-blue";
                startTimeText = "12:00 PM";
                endTimeText = "10:00 PM";
                details = "12:00 PM to 10:00 PM";
            } 
            
            const timeExtractMatch = lower.match(/([0-9]{1,2}(?::[0-9]{2})?\s*(?:a\.m\.|p\.m\.|am|pm)?)\s*(?:to|-)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:a\.m\.|p\.m\.|am|pm)?)/i);
            if (timeExtractMatch && !lower.includes('urgent')) {
                startTimeText = timeExtractMatch[1].toUpperCase().replace(/\./g, '');
                endTimeText = timeExtractMatch[2].toUpperCase().replace(/\./g, '');
                
                if (!startTimeText.includes('AM') && !startTimeText.includes('PM')) {
                    const startHr = parseInt(startTimeText, 10);
                    startTimeText += (startHr < 7 ? ' PM' : ' AM');
                }
                if (!endTimeText.includes('AM') && !endTimeText.includes('PM')) {
                    endTimeText += ' PM';
                }
                details = `${startTimeText} to ${endTimeText}`;
            }

            let roomInfo = "";
            const roomMatch = lower.match(/room\s+([a-z0-9]+)/i);
            if (roomMatch) {
                roomInfo = ` (Room ${roomMatch[1]})`;
                details += roomInfo;
            }

            const shiftDate = new Date(Date.UTC(targetYear, targetMonth, dayNum));

            const existingIndex = existingShifts.findIndex(s => new Date(s.date).getUTCDate() === dayNum && new Date(s.date).getUTCMonth() === targetMonth);
            const newShift = {
                shiftType,
                colorCode,
                details,
                date: shiftDate.toISOString(),
                startTimeText,
                endTimeText
            };

            if (existingIndex >= 0) {
                existingShifts[existingIndex] = newShift;
            } else {
                existingShifts.push(newShift);
            }
        });

        existingShifts.sort((a, b) => new Date(a.date) - new Date(b.date));

        fs.writeFileSync(STORAGE_FILE, JSON.stringify(existingShifts, null, 2));

        res.json({
            success: true,
            shifts: existingShifts
        });

    } catch (error) {
        console.error('Voice Parsing Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update or delete shifts
app.post('/api/update-schedule', (req, res) => {
    try {
        const { shifts } = req.body;
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(shifts || [], null, 2));
        res.json({ success: true, shifts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route to generate and download the .ics Apple Calendar file
app.post('/api/export-calendar', (req, res) => {
    try {
        let shifts = [];
        if (fs.existsSync(STORAGE_FILE)) {
            shifts = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        }

        const calendar = ical({ name: 'Work Schedule' });

        if (Array.isArray(shifts)) {
            shifts.forEach((shift) => {
                const startDate = new Date(shift.date);
                const endDate = new Date(shift.date);

                if (shift.startTimeText && shift.endTimeText) {
                    const startParsed = parseTimeStringToHours(shift.startTimeText);
                    const endParsed = parseTimeStringToHours(shift.endTimeText);

                    startDate.setUTCHours(startParsed.hours, startParsed.minutes, 0, 0);
                    endDate.setUTCHours(endParsed.hours, endParsed.minutes, 0, 0);

                    if (endDate <= startDate) {
                        endDate.setUTCDate(endDate.getUTCDate() + 1);
                    }
                } else {
                    endDate.setUTCHours(startDate.getUTCHours() + 8);
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
    console.log(`Server running on port ${PORT}`);
});