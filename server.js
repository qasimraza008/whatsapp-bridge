const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

const clients = {}; 
const qrCodes = {}; 
const clientStatus = {}; 
const PORT = process.env.PORT || 3000;

function getOrCreateClient(schoolId) {
    if (clients[schoolId]) return clients[schoolId];

    clientStatus[schoolId] = 'connecting';
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: `school_${schoolId}` }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', async (qr) => {
        try {
            qrCodes[schoolId] = await qrcode.toDataURL(qr);
            clientStatus[schoolId] = 'disconnected';
        } catch (err) {
            console.error(`QR error school ${schoolId}:`, err);
        }
    });

    client.on('ready', () => {
        clientStatus[schoolId] = 'connected';
        qrCodes[schoolId] = null;
    });

    client.on('auth_failure', () => {
        clientStatus[schoolId] = 'disconnected';
        qrCodes[schoolId] = null;
    });

    client.on('disconnected', () => {
        clientStatus[schoolId] = 'disconnected';
        delete clients[schoolId];
        delete qrCodes[schoolId];
    });

    client.initialize().catch(err => {
        clientStatus[schoolId] = 'disconnected';
    });

    clients[schoolId] = client;
    return client;
}

app.get('/api/status/:schoolId', (req, res) => {
    const schoolId = req.params.schoolId;
    res.json({
        status: clientStatus[schoolId] || 'disconnected',
        qr: qrCodes[schoolId] || null,
        phone: clients[schoolId]?.info?.wid?.user || null
    });
});

app.post('/api/connect', (req, res) => {
    const { schoolId } = req.body;
    if (!schoolId) return res.status(400).json({ ok: false, msg: 'Missing schoolId' });
    getOrCreateClient(schoolId);
    res.json({ ok: true, msg: 'Connection process started' });
});

app.post('/api/send', async (req, res) => {
    const { schoolId, phone, message } = req.body;
    const client = clients[schoolId];
    
    if (!client || clientStatus[schoolId] !== 'connected') {
        return res.status(400).json({ ok: false, msg: 'WhatsApp not connected for this school' });
    }

    try {
        let formattedPhone = phone.replace(/\D/g, '');
        if (!formattedPhone.endsWith('@c.us')) {
            formattedPhone += '@c.us';
        }
        const response = await client.sendMessage(formattedPhone, message);
        res.json({ ok: true, messageId: response.id.id });
    } catch (error) {
        res.status(500).json({ ok: false, msg: error.message });
    }
});

app.post('/api/disconnect', async (req, res) => {
    const { schoolId } = req.body;
    if (clients[schoolId]) {
        try {
            await clients[schoolId].logout();
            await clients[schoolId].destroy();
        } catch (e) {}
        delete clients[schoolId];
        delete qrCodes[schoolId];
        clientStatus[schoolId] = 'disconnected';
    }
    res.json({ ok: true, msg: 'Disconnected successfully' });
});

app.listen(PORT, () => {
    console.log(`WhatsApp Bridge running on port ${PORT}`);
});
