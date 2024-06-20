const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

const LOGINURL = 'https://erp.cisin.com/login.asp';
const COMPTIMESHEETURL = 'https://erp.cisin.com/timesheetnew.asp';

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/public/index.html'));
});


app.post('/submit', async (req, res) => {
    const { email, password } = req.body;
    console.log('Received form submission with email:', email);

    try {
        const result = await runPyppeteer(email, password);
        console.log('Result:', result);

        if (result) {
            res.json({ over: result[0], short: result[1] });
        } else {
            res.status(400).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Error during /submit POST route:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


async function runPyppeteer(email, password) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions'
        ]
    });

    try {
        const page = await browser.newPage();

        // Login
        await page.goto(LOGINURL);
        await page.type('input[name=uname]', email);
        await page.type('input[name=pass]', password);
        await Promise.all([
            page.click('input.submit-login'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);
        // Check for successful login by looking for an element that is only present after login
        const isLoggedIn = await page.evaluate(() => {
            // Replace 'elementSelector' with a selector for an element that is only present after successful login
            return !!document.querySelector('elementSelector');
        });

        if (!isLoggedIn) {
            // If not logged in successfully, return early
            console.log('Login failed');
            return false;
        }

        // Navigate to timesheet
        await page.goto(COMPTIMESHEETURL);
        await page.waitForSelector('table#product-table');

        // Extract data
        const tables = await page.$$eval('table#product-table', tables => tables.map(table => table.innerHTML));

        if (tables.length > 0) {
            const firstTableContent = tables[0];
            const rows = await page.evaluate(firstTableContent => {
                const table = document.createElement('table');
                table.innerHTML = firstTableContent;
                return Array.from(table.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim()));
            }, firstTableContent);

            const log = rows[14].slice(1).map(cell => extractHoursAndMinutes(cell)).filter(Boolean);
            return calcTime(log);
        } else {
            return false;
        }
    } catch (error) {
        console.error('Error during Puppeteer operation:', error);
        return false;
    } finally {
        await browser.close();
    }
}

function extractHoursAndMinutes(text) {
    const regex = /(\d+)\s*hrs,\s*(\d+)\s*min/;
    const match = text.match(regex);
    if (match) {
        return [parseInt(match[1]), parseInt(match[2])];
    }
    return null;
}

function calcTime(log) {
    const stdMinutes = 8 * 60; // Standard 8 hours in minutes
    let totalMinutes = 0;

    log.forEach(([hours, minutes]) => {
        totalMinutes += hours * 60 + minutes;
    });

    const overtime = Math.max(0, totalMinutes - (log.length * stdMinutes));
    const shortfall = Math.max(0, (log.length * stdMinutes) - totalMinutes);

    const otHours = Math.floor(overtime / 60);
    const otMinutes = overtime % 60;
    const sfHours = Math.floor(shortfall / 60);
    const sfMinutes = shortfall % 60;

    return [
        `Over Time: ${otHours} hrs, ${otMinutes} min`,
        `Short Time: ${sfHours} hrs, ${sfMinutes} min`
    ];
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
