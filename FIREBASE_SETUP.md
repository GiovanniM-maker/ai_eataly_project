# Firebase Setup Instructions

## Configurazione Firestore

Per far funzionare correttamente l'app, devi configurare le regole di sicurezza di Firestore.

### 1. Vai alla Console Firebase
- Accedi a https://console.firebase.google.com/
- Seleziona il progetto: `eataly-creative-ai-suite`

### 2. Configura Firestore Database
- Vai su **Firestore Database** nel menu laterale
- Se non hai ancora creato il database, clicca su **Crea database**
- Scegli la modalità **Produzione** o **Test** (per sviluppo puoi usare Test)

### 3. Configura le Regole di Sicurezza

Vai su **Regole** nella sezione Firestore e imposta queste regole:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Regole per la collezione chats
    match /chats/{chatId} {
      // Permetti lettura e scrittura a tutti (per sviluppo)
      // In produzione, dovresti aggiungere autenticazione
      allow read, write: if true;
    }
  }
}
```

**⚠️ Nota di Sicurezza:** Le regole sopra permettono a chiunque di leggere e scrivere. Per un'app in produzione, dovresti:
1. Aggiungere autenticazione Firebase
2. Limitare l'accesso solo agli utenti autenticati
3. Implementare regole più specifiche basate sull'utente

### 4. Struttura dei Dati

L'app crea automaticamente documenti nella collezione `chats` con questa struttura:

```javascript
{
  title: "Titolo della chat",
  messages: [
    {
      role: "user" | "assistant",
      content: "Contenuto del messaggio",
      timestamp: "2024-01-01T00:00:00.000Z"
    }
  ],
  model: "gpt-4",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 5. Test

Dopo aver configurato Firestore:
1. Ricarica l'app
2. Crea una nuova chat
3. Invia un messaggio
4. Verifica che i dati appaiano nella console Firebase

## Troubleshooting

- **Errore "Permission denied"**: Controlla le regole di sicurezza di Firestore
- **Errore "Collection not found"**: Assicurati che Firestore sia abilitato nel progetto
- **Dati non si salvano**: Verifica che le regole permettano la scrittura

