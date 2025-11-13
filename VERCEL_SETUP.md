# 🚀 Configurazione Vercel per Google Gemini

## 📋 Variabili d'Ambiente Richieste

### Backend (Serverless Functions)

Vai su **Vercel Dashboard → Settings → Environment Variables**

### **GOOGLE_SERVICE_ACCOUNT_JSON** (OBBLIGATORIO)

- **Tipo**: String (JSON completo del Service Account)
- **Dove**: Vercel Environment Variables → **Production, Preview, Development**
- **Formato**: Stringa JSON completa (usa le virgolette doppie)
- **⚠️ IMPORTANTE**: Il nome della variabile è `GOOGLE_SERVICE_ACCOUNT_JSON` (non `GOOGLE_SERVICE_ACCOUNT`)

**⚠️ IMPORTANTE**: Inserisci l'intero JSON come stringa, mantenendo i caratteri `\n` per i newline nella private_key.

**Esempio** (usa questo formato esatto - sostituisci con i tuoi valori):

```
{"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"your-service-account@your-project.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}
```

**⚠️ IMPORTANTE**: Usa il Service Account JSON che hai ricevuto, non copiare questo esempio.

### Frontend (Build Time - Opzionale)

Se vuoi usare variabili d'ambiente per Firebase (attualmente hardcoded):

```
VITE_FIREBASE_API_KEY=AIzaSyBfW-DJsytPbGbIutbYfd9kXO9y7jCqCEg
VITE_FIREBASE_AUTH_DOMAIN=eataly-creative-ai-suite.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=eataly-creative-ai-suite
VITE_FIREBASE_STORAGE_BUCKET=eataly-creative-ai-suite.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=392418318075
VITE_FIREBASE_APP_ID=1:392418318075:web:3c1aa88df71dca64da425e
VITE_FIREBASE_MEASUREMENT_ID=G-GSE68WH3P9
```

**Nota**: Attualmente Firebase è configurato con valori hardcoded, quindi queste variabili sono opzionali.

## 🔧 Come Configurare su Vercel

### 1. Vai su Vercel Dashboard
- Accedi a https://vercel.com
- Seleziona il tuo progetto

### 2. Aggiungi Variabili d'Ambiente
- Vai su **Settings** → **Environment Variables**
- Clicca **Add New**
- Nome: `GOOGLE_SERVICE_ACCOUNT_JSON`
- Valore: Incolla l'intero JSON del Service Account (come stringa)
- Seleziona: **Production**, **Preview**, **Development**
- Clicca **Save**

### 3. Redeploy
- Dopo aver aggiunto le variabili, vai su **Deployments**
- Clicca sui 3 puntini del deployment più recente
- Seleziona **Redeploy**
- Oppure fai un nuovo push su GitHub

## ✅ Verifica Configurazione

### Test API Endpoint

Dopo il deploy, puoi testare l'endpoint:

```bash
curl -X POST https://your-app.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "contents": [{
      "role": "user",
      "parts": [{"text": "Hello!"}]
    }]
  }'
```

### Controlla Logs

- Vai su **Deployments** → Seleziona un deployment → **Functions** → `api/chat`
- Controlla i logs per eventuali errori

## 🐛 Troubleshooting

### Errore: "Missing GOOGLE_SERVICE_ACCOUNT_JSON"
- Verifica che la variabile sia impostata su Vercel con il nome corretto: `GOOGLE_SERVICE_ACCOUNT_JSON`
- Assicurati di aver selezionato tutti gli ambienti (Production, Preview, Development)
- Fai un redeploy dopo aver aggiunto la variabile

### Errore: "Token request failed"
- Verifica che il Service Account abbia i permessi corretti
- Controlla che il JSON sia valido (usa un validator JSON online)
- Assicurati che i `\n` nella private_key siano preservati

### Errore CORS
- Se vedi errori CORS, aggiungi il tuo dominio a `ALLOWED_ORIGINS` in `api/generate.js`
- Oppure usa il pattern `https://*.vercel.app` già presente

### Messaggi non appaiono in chat
- Controlla la console del browser (F12) per errori
- Verifica che l'endpoint `/api/generate` risponda correttamente
- Controlla i logs di Vercel per errori serverless

## 📝 Note Importanti

1. **Service Account**: Deve avere il permesso `Generative Language API` su Google Cloud Console
2. **CORS**: L'API accetta richieste solo da origini autorizzate
3. **Rate Limiting**: Google ha limiti di rate, controlla la console Google Cloud
4. **Token Caching**: L'access token viene cachato per 1 ora per ottimizzare le performance

## 🔗 Link Utili

- [Google Cloud Console](https://console.cloud.google.com/)
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

