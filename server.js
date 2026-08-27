const express = require('express');
const cors = require('cors');
const path = require('path');
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

// Helper: Convert time strings like "7:00 AM" or "10:00 PM" into hours/minutes
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

// Route to parse voice-transcribed text into structured calendar shifts
app.post('/api/parse-voice', (req, res) => {
    try {
        const { text, year, month } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: 'No text provided' });
        }

        const targetYear = year !== undefined ? parseInt(year, 10) : 2026;
        const targetMonth = month !== undefined ? parseInt(month, 10) : 7; // August (0-indexed: 7)

        const shifts = [];
        
        // Split transcript into clauses based on periods, commas, or conjunctions
        const segments = text.split(/(?:\.|\,|\b(?:and|also|then|next)\b)/i);

        segments.forEach(segment => {
            const lower = segment.toLowerCase().trim();
            if (!lower) return;

            // Extract day number (matches "1st", "August 5th", "the 12th", etc.)
            const dayMatch = lower.match(/(?:august\s*)?([1-3]?[0-9])(?:st|nd|rd|th)?/);
            if (!dayMatch) return;

            const dayNum = parseInt(dayMatch[1], 10);
            if (dayNum < 1 || dayNum > 31) return;

            // Default shift settings (General Shift: 7:00 AM to 6:00 PM)
            let shiftType = "General Shift";
            let colorCode = "light-blue";
            let startTimeText = "7:00 AM";
            let endTimeText = "6:00 PM";
            let details = "7:00 AM to 6:00 PM";

            // Identify Urgent Care or custom variation shifts
            if (lower.includes('urgent') || lower.includes('urgent care') || lower.includes('12 to 10') || lower.includes('12p')) {
                shiftType = "Urgent Care";
                colorCode = "dark-blue";
                startTimeText = "12:00 PM";
                endTimeText = "10:00 PM";
                details = "12:00 PM to 10:00 PM";
            } else if (lower.includes('1 to 6') || lower.includes('one to six')) {
                startTimeText = "1:00 PM";
                endTimeText = "6:00 PM";
                details = "1:00 PM to 6:00 PM";
            } else if (lower.includes('2 to 6') || lower.includes('two to six')) {
                startTimeText = "2:00 PM";
                endTimeText = "6:00 PM";
                details = "2:00 PM to 6:00 PM";
            } else if (lower.includes('12 to 1') || lower.includes('twelve to one')) {
                startTimeText = "12:00 PM";
                endTimeText = "1:00 PM";
                details = "12:00 PM to 1:00 PM";
            }

            const shiftDate = new Date(targetYear, targetMonth, dayNum);

            // Avoid duplicates for the same day
            const existingIndex = shifts.findIndex(s => new Date(s.date).getDate() === dayNum);
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
        });

        // Sort chronologically
        shifts.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({
            success: true,
            shifts
        });

    } catch (error) {
        console.error('Voice Parsing Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route to generate and download the .ics Apple Calendar file
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
    console.log(`Server running on port ${PORT}`);
});