const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===========================================
// BANCO DE DADOS DE LICENÇAS (EM MEMÓRIA)
// Em produção, use MongoDB, MySQL, PostgreSQL, etc.
// ===========================================

const licenses = {
    "TEST-1234-ABCD-5678": {
        username: "Usuario1",
        hwid: null, // null = permite qualquer HWID na primeira ativação
        expiry: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 dias
        status: "active"
    },
    "LIFETIME-KEY-9999": {
        username: "UsuarioVIP",
        hwid: null,
        expiry: 9999999999, // Lifetime (ano 2286)
        status: "active"
    },
    "DEMO-KEY-2024": {
        username: "Demo",
        hwid: null,
        expiry: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 dias
        status: "active"
    }
};

// ===========================================
// ROTAS
// ===========================================

// Rota principal
app.get('/', (req, res) => {
    res.json({
        message: "LicenseGuard API - Sistema de Validação de Licenças",
        version: "1.0.0",
        endpoints: {
            validate: "/api/validate?license=KEY&hwid=HWID",
            create: "/api/create (POST)",
            delete: "/api/delete (POST)",
            list: "/api/list"
        }
    });
});

// Endpoint de validação (usado pelo client C++)
app.get('/api/validate', (req, res) => {
    const { license, hwid } = req.query;

    // Validação dos parâmetros
    if (!license) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: "Parâmetro 'license' é obrigatório"
        });
    }

    if (!hwid) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: "Parâmetro 'hwid' é obrigatório"
        });
    }

    // Verifica se a licença existe
    const licenseData = licenses[license];

    if (!licenseData) {
        return res.json({
            success: false,
            valid: false,
            status: "invalid",
            message: "Licença não encontrada ou inválida"
        });
    }

    // Verifica se a licença está ativa
    if (licenseData.status !== "active") {
        return res.json({
            success: false,
            valid: false,
            status: licenseData.status,
            message: `Licença está ${licenseData.status}`
        });
    }

    // Verifica se a licença expirou
    const now = Math.floor(Date.now() / 1000);
    if (licenseData.expiry < now) {
        licenseData.status = "expired";
        return res.json({
            success: false,
            valid: false,
            status: "expired",
            message: "Licença expirada"
        });
    }

    // Verifica HWID (se já estiver registrado)
    if (licenseData.hwid === null) {
        // Primeira ativação - registra o HWID
        licenseData.hwid = hwid;
        console.log(`[ATIVAÇÃO] Licença ${license} ativada para HWID: ${hwid}`);
    } else if (licenseData.hwid !== hwid) {
        // HWID diferente do registrado
        return res.json({
            success: false,
            valid: false,
            status: "hwid_mismatch",
            message: "HWID não autorizado para esta licença"
        });
    }

    // Licença válida!
    return res.json({
        success: true,
        valid: true,
        status: "active",
        message: "Licença válida",
        username: licenseData.username,
        expiry: licenseData.expiry.toString(),
        hwid: licenseData.hwid
    });
});

// Criar nova licença (POST)
app.post('/api/create', (req, res) => {
    const { license, username, days, hwid } = req.body;

    if (!license || !username) {
        return res.status(400).json({
            success: false,
            message: "Parâmetros 'license' e 'username' são obrigatórios"
        });
    }

    if (licenses[license]) {
        return res.status(400).json({
            success: false,
            message: "Esta licença já existe"
        });
    }

    const daysValue = parseInt(days) || 30;
    const isLifetime = daysValue > 10000;
    const expiryTimestamp = isLifetime 
        ? 9999999999 
        : Math.floor(Date.now() / 1000) + (daysValue * 24 * 60 * 60);

    licenses[license] = {
        username: username,
        hwid: hwid || null,
        expiry: expiryTimestamp,
        status: "active"
    };

    res.json({
        success: true,
        message: "Licença criada com sucesso",
        license: license,
        username: username,
        expiry: expiryTimestamp,
        days: isLifetime ? "Lifetime" : daysValue
    });

    console.log(`[CRIAÇÃO] Nova licença criada: ${license} para ${username}`);
});

// Deletar licença (POST)
app.post('/api/delete', (req, res) => {
    const { license } = req.body;

    if (!license) {
        return res.status(400).json({
            success: false,
            message: "Parâmetro 'license' é obrigatório"
        });
    }

    if (!licenses[license]) {
        return res.status(404).json({
            success: false,
            message: "Licença não encontrada"
        });
    }

    delete licenses[license];

    res.json({
        success: true,
        message: "Licença deletada com sucesso"
    });

    console.log(`[DELEÇÃO] Licença deletada: ${license}`);
});

// Listar todas as licenças
app.get('/api/list', (req, res) => {
    const licenseList = Object.keys(licenses).map(key => ({
        license: key,
        username: licenses[key].username,
        hwid: licenses[key].hwid || "Não ativada",
        expiry: licenses[key].expiry,
        status: licenses[key].status,
        daysRemaining: Math.floor((licenses[key].expiry - Math.floor(Date.now() / 1000)) / 86400)
    }));

    res.json({
        success: true,
        count: licenseList.length,
        licenses: licenseList
    });
});

// Resetar HWID de uma licença (POST)
app.post('/api/reset-hwid', (req, res) => {
    const { license } = req.body;

    if (!license) {
        return res.status(400).json({
            success: false,
            message: "Parâmetro 'license' é obrigatório"
        });
    }

    if (!licenses[license]) {
        return res.status(404).json({
            success: false,
            message: "Licença não encontrada"
        });
    }

    licenses[license].hwid = null;

    res.json({
        success: true,
        message: "HWID resetado com sucesso. Licença pode ser reativada."
    });

    console.log(`[RESET] HWID resetado para licença: ${license}`);
});

// Rota 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint não encontrado"
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   LicenseGuard API - Servidor Rodando     ║
╚════════════════════════════════════════════╝

🚀 Porta: ${PORT}
🌐 URL: http://localhost:${PORT}

📋 Licenças de teste disponíveis:
   - TEST-1234-ABCD-5678 (30 dias)
   - LIFETIME-KEY-9999 (Lifetime)
   - DEMO-KEY-2024 (7 dias)

📡 Endpoints:
   GET  /api/validate?license=KEY&hwid=HWID
   POST /api/create
   POST /api/delete
   POST /api/reset-hwid
   GET  /api/list

✅ Pronto para receber requisições!
    `);
});
