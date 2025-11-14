# 🧪 Test Manuali - Sistema di Routing Modelli

## Test da eseguire per verificare il routing automatico

### ✅ Test 1: Modelli Text → `/api/chat`

**Modelli da testare:**
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

**Procedura:**
1. Seleziona un modello text dal dropdown
2. Invia un messaggio di testo (es: "Ciao, come stai?")
3. Verifica che:
   - La richiesta vada a `/api/chat`
   - La risposta sia testo
   - Il messaggio sia salvato in Firestore con `type: "text"` (o struttura legacy)
   - Il messaggio appaia correttamente nella chat

**Risultato atteso:** ✅ Messaggio di testo ricevuto e salvato

---

### ✅ Test 2: Modelli Image → `/api/generateImage`

**Modelli da testare:**
- `gemini-2.5-flash-image` (Nano Banana)
- `imagen-4`
- `imagen-4-ultra`
- `imagen-4-fast`
- `imagen-3`

**Procedura:**
1. Seleziona un modello image dal dropdown
2. Invia un prompt (es: "A beautiful sunset over the ocean")
3. Verifica che:
   - La richiesta vada a `/api/generateImage`
   - Venga generata un'immagine
   - L'immagine sia caricata su PostImages.org
   - Il messaggio sia salvato in Firestore con `type: "image"`, `url`
   - L'immagine appaia correttamente nella chat

**Risultato atteso:** ✅ Immagine generata e visualizzata

---

### ✅ Test 3: Modelli Vision → `/api/generateVision`

**Modelli da testare:**
- `gemini-2.5-pro-vision`
- `gemini-1.5-pro-vision`

**Procedura:**
1. Seleziona un modello vision dal dropdown
2. Invia un messaggio (es: "Describe this image" - per ora senza immagine)
3. Verifica che:
   - La richiesta vada a `/api/generateVision`
   - Venga ricevuta un'analisi (anche se senza immagine)
   - Il messaggio sia salvato in Firestore con `type: "vision"`, `analysis`
   - Il messaggio appaia con badge "👁️ Vision Analysis"

**Risultato atteso:** ✅ Analisi vision ricevuta e visualizzata

---

### ✅ Test 4: Modelli Audio → `/api/generateAudio`

**Modelli da testare:**
- `gemini-2.5-flash-audio`
- `gemini-1.5-flash-audio`

**Procedura:**
1. Seleziona un modello audio dal dropdown
2. Invia un messaggio (es: "Convert this to speech")
3. Verifica che:
   - La richiesta vada a `/api/generateAudio`
   - Venga ricevuto un transcript (e possibilmente audio)
   - Il messaggio sia salvato in Firestore con `type: "audio"`, `transcript`, `audioUrl`
   - Il messaggio appaia con badge "🔊 Audio Response"
   - Se presente `audioUrl`, il player audio sia funzionante

**Risultato atteso:** ✅ Transcript audio ricevuto e visualizzato

---

### ✅ Test 5: Validazione Endpoint Errato

**Procedura:**
1. Prova a inviare un modello image a `/api/chat` (dovrebbe essere bloccato)
2. Prova a inviare un modello text a `/api/generateImage` (dovrebbe essere bloccato)

**Risultato atteso:** ✅ Errore 400 con messaggio "Wrong endpoint"

---

### ✅ Test 6: Persistenza Firestore

**Procedura:**
1. Invia messaggi con diversi tipi (text, image, vision, audio)
2. Ricarica la pagina
3. Verifica che:
   - Tutti i messaggi vengano ricaricati correttamente
   - Le immagini siano visualizzate
   - I badge vision/audio siano presenti
   - L'audio player funzioni se presente

**Risultato atteso:** ✅ Tutti i messaggi ricaricati correttamente

---

### ✅ Test 7: Tooltip Modelli

**Procedura:**
1. Apri il dropdown modelli
2. Passa il mouse su ogni icona "?" accanto ai modelli
3. Verifica che:
   - Il tooltip appaia con la descrizione corretta
   - Le descrizioni siano quelle specificate in `MODEL_INFO`

**Risultato atteso:** ✅ Tooltip funzionanti con descrizioni corrette

---

### ✅ Test 8: Label Modello nei Messaggi

**Procedura:**
1. Invia un messaggio con un modello
2. Cambia modello
3. Invia un altro messaggio
4. Verifica che:
   - I messaggi vecchi mostrino "Model: [nome modello]" se diverso da quello selezionato
   - Il label sia piccolo, sottile, italic

**Risultato atteso:** ✅ Label modello visibile quando diverso

---

## Checklist Completa

- [ ] Test text models → `/api/chat`
- [ ] Test image models → `/api/generateImage`
- [ ] Test vision models → `/api/generateVision`
- [ ] Test audio models → `/api/generateAudio`
- [ ] Test validazione endpoint errato
- [ ] Test persistenza Firestore
- [ ] Test tooltip modelli
- [ ] Test label modello nei messaggi

---

## Note

- Se un test fallisce, controlla i log della console del browser e del backend
- Verifica che le variabili d'ambiente siano configurate correttamente su Vercel
- Assicurati che Firestore abbia le regole corrette per la scrittura

