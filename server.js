const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

const clients = {}; // schoolId => client
const clientStatus = {}; // schoolId => 'disconnected' | 'connecting' | 'connected'
const qrCodes = {}; // schoolId => base64 QR image

app.get('/', (req, res) => {
    res.send('WhatsApp Bridge running successfully!');
});

// 1. Connect / Initialize Client
app.post('/api/connect', (req, res) => {
    const { schoolId } = req.body;
    if (!schoolId) return res.status(400).json({ ok: false, msg: 'School ID required' });

    if (clients[schoolId]) {
        return res.json({ ok: true, status: clientStatus[schoolId] || 'initialized' });
    }

    clientStatus[schoolId] = 'connecting';
    qrCodes[schoolId] = null;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: `school_${schoolId}` }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    clients[schoolId] = client;

    client.on('qr', async (qr) => {
        try {
            const qrImage = await qrcode.toDataURL(qr);
            qrCodes[schoolId] = qrImage;
            clientStatus[schoolId] = 'qr_ready';
        } catch (err) {
            console.error('QR Generate Error:', err);
        }
    });

    client.on('ready', () => {
        console.log(`School ${schoolId} WhatsApp Ready!`);
        clientStatus[schoolId] = 'connected';
        qrCodes[schoolId] = null;
    });

    client.on('authenticated', () => {
        clientStatus[schoolId] = 'authenticated';
    });

    client.on('auth_failure', (msg) => {
        console.error(`School ${schoolId} Auth Failure:`, msg);
        clientStatus[schoolId] = 'disconnected';
    });

    client.on('disconnected', (reason) => {
        console.log(`School ${schoolId} Disconnected:`, reason);
        clientStatus[schoolId] = 'disconnected';
        delete clients[schoolId];
        delete qrCodes[schoolId];
    });

    client.initialize().catch(err => {
        console.error(`School ${schoolId} Init Error:`, err);
        clientStatus[schoolId] = 'disconnected';
    });

    res.json({ ok: true, status: 'connecting' });
});

// 2. Status & QR Endpoint
app.get('/api/status/:schoolId', (req, res) => {
    const schoolId = req.params.schoolId;
    const status = clientStatus[schoolId] || 'disconnected';
    const qr = qrCodes[schoolId] || null;

    res.json({
        ok: true,
        status: status,
        qr: qr
    });
});

// 3. Send Message Endpoint
app.post('/api/send', async (req, res) => {
    const { schoolId, phone, message } = req.body;
    const client = clients[schoolId];

    if (!client || clientStatus[schoolId] !== 'connected') {
        return res.status(400).json({ ok: false, msg: 'WhatsApp not connected for this school' });
    }

    try {
        let chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await client.sendMessage(chatId, message);
        res.json({ ok: true, msg: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ ok: false, msg: err.message });
    }
});

// 4. Disconnect / Logout
app.post('/api/disconnect', async (req, res) => {
    const { schoolId } = req.body;
    const client = clients[schoolId];

    if (client) {
        try {
            await client.logout();
            await client.destroy();
        } catch (e) {}
        delete clients[schoolId];
        delete qrCodes[schoolId];
        clientStatus[schoolId] = 'disconnected';
    }

    res.json({ ok: true, msg: 'Disconnected successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`WhatsApp Bridge server running on port ${PORT}`);
});
