# LicenseGuard API - Sistema de Validação de Licenças

Sistema completo de backend para validação de licenças customizado, compatível com o client C++ do Hyperx-FiveM.

## 🚀 Como Usar

### 1. Instalação Local (Teste)

```bash
cd Backend-LicenseGuard
npm install
npm start
```

O servidor vai rodar em `http://localhost:3000`

### 2. Deploy no Railway

#### Opção A: Via GitHub (Recomendado)

1. Crie um repositório no GitHub
2. Faça upload da pasta `Backend-LicenseGuard`
3. Acesse https://railway.app
4. Clique em "New Project" > "Deploy from GitHub repo"
5. Selecione seu repositório
6. Railway vai detectar automaticamente e fazer deploy!

#### Opção B: Via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### 3. Configurar a URL no Client

Após o deploy, você vai receber uma URL tipo:
`https://seu-projeto.up.railway.app`

Copie essa URL e cole no arquivo:
`src/Auth/CustomAuth.hpp` na linha 91

## 📡 Endpoints Disponíveis

### `GET /api/validate`
Valida uma licença (usado pelo client C++)

**Parâmetros:**
- `license`: Chave de licença
- `hwid`: HWID da máquina

**Exemplo:**
```
GET /api/validate?license=TEST-1234-ABCD-5678&hwid=ABC123
```

**Resposta Sucesso:**
```json
{
  "success": true,
  "valid": true,
  "status": "active",
  "message": "Licença válida",
  "username": "Usuario1",
  "expiry": "1735689600",
  "hwid": "ABC123"
}
```

### `POST /api/create`
Cria uma nova licença

**Body (JSON):**
```json
{
  "license": "NOVA-KEY-2024",
  "username": "NomeUsuario",
  "days": 30,
  "hwid": null
}
```

**Exemplo com curl:**
```bash
curl -X POST http://localhost:3000/api/create \
  -H "Content-Type: application/json" \
  -d '{"license":"NOVA-KEY-2024","username":"Usuario","days":30}'
```

### `POST /api/delete`
Deleta uma licença

**Body (JSON):**
```json
{
  "license": "KEY-PARA-DELETAR"
}
```

### `POST /api/reset-hwid`
Reseta o HWID de uma licença (permite reativar em outro PC)

**Body (JSON):**
```json
{
  "license": "TEST-1234-ABCD-5678"
}
```

### `GET /api/list`
Lista todas as licenças cadastradas

**Exemplo:**
```
GET /api/list
```

## 🔑 Licenças de Teste

O sistema vem com 3 licenças de teste:

1. **TEST-1234-ABCD-5678**
   - Validade: 30 dias
   - Usuário: Usuario1

2. **LIFETIME-KEY-9999**
   - Validade: Lifetime (vitalícia)
   - Usuário: UsuarioVIP

3. **DEMO-KEY-2024**
   - Validade: 7 dias
   - Usuário: Demo

## 🛡️ Sistema de HWID

- Na primeira ativação, o HWID é registrado automaticamente
- Tentativas de usar a mesma key em outro PC serão bloqueadas
- Use `/api/reset-hwid` para permitir reativação

## 📊 Banco de Dados

**Atual:** Em memória (para testes)

**Para produção, recomendo usar:**
- MongoDB (fácil de integrar com Railway)
- PostgreSQL (Railway oferece gratuitamente)
- MySQL

### Exemplo com MongoDB:

```javascript
const mongoose = require('mongoose');

const LicenseSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    username: String,
    hwid: String,
    expiry: Number,
    status: String
});

const License = mongoose.model('License', LicenseSchema);
```

## 🔧 Variáveis de Ambiente

No Railway, configure:
- `PORT`: Definida automaticamente pelo Railway
- `MONGO_URI`: (opcional) Se usar MongoDB

## 📝 Logs

O servidor exibe logs de:
- ✅ Ativações de licença
- 🆕 Criação de licenças
- 🗑️ Deleção de licenças
- 🔄 Reset de HWID

## 🐛 Troubleshooting

### Erro: "Cannot connect to server"
- Verifique se o servidor está rodando
- Teste a URL no navegador: `https://sua-url.up.railway.app`

### Erro: "HWID não autorizado"
- Use `/api/reset-hwid` para resetar o HWID da licença

### Erro: "Licença expirada"
- Crie uma nova licença ou aumente a validade

## 📞 Suporte

Para dúvidas ou problemas, verifique os logs do servidor.

## 📄 Licença

MIT License - Livre para usar e modificar
