// Add this route handler to replace the old image-parsing route in server.js

app.post('/api/parse-voice', (req, res) => {
    try {
        const { text, year, month } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: 'No text provided' });
        }

        const targetYear = year !== undefined ? parseInt(year, 10) : 2026;
        const targetMonth = month !== undefined ? parseInt(month, 10) : 7; // August

        const shifts = [];
        
        // Split transcript into individual sentences or clauses based on common pauses/periods
        const segments = text.split(/(?:\.|\b(?:and|also|then)\b)/i);

        segments.forEach(segment => {
            const lower = segment.toLowerCase();

            // Extract day number (e.g., "August 1st", "on the 5th", "day 12")
            const dayMatch = lower.match(/(?:august\s*)?([1-3]?[0-9])(?:st|nd|rd|th)?/);
            if (!dayMatch) return;

            const dayNum = parseInt(dayMatch[1], 10);
            if (dayNum < 1 || dayNum > 31) return;

            // Determine shift type
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

            // Prevent duplicate entries for the same day
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