require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require ("path");
const axios = require ("axios");
const OpenAI = require("openai");

const app = express();

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST endpoint for punctuation correction
app.post("/punctuate", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a text formatter. Your job is to add punctuation and proper capitalization to spoken Indonesian text. In the events that sentence structural mistakes are present, you are to fix the sentence to a proper formatting and structure. Under no circumstances should you ask the user for more context or pose questions. If the text is too short (fewer than three words), simply return it unchanged.",
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.3,
    });

    const formattedText = response.choices[0].message.content.trim();
    res.json({ formattedText });
  } catch (error) {
    console.error("Error in /punctuate:", error);
    res.status(500).json({ error: "Failed to punctuate text" });
  }
});

// Endpoint to return Deepgram token (if used)
app.get("/deepgram-token", (req, res) => {
  const DG_KEY = process.env.DG_KEY;
  if (!DG_KEY) {
    return res.status(500).json({ error: "Deepgram API key not found" });
  }
  res.json({ key: DG_KEY });
});

app.post("/transcribe-audio", async (req, res) => {
  try {
    const { audioUrl } = req.body;
    if (!audioUrl) {
      return res.status(400).json({ error: "Audio URL harus disediakan" });
    }

    const response = await axios.post(
  'https://api.deepgram.com/v1/listen',
  { url: audioUrl },
  {
    headers: {
      Authorization: `Token ${process.env.DG_KEY}`,
      'Content-Type': 'application/json'
    },
    params: {
      model: 'nova-2',
      punctuate: false,  // ✅ Harus ada
      diarize: true,
      diarize_speaker_count: 18, //Limiting and Forcing exactly n amount of speaker
      smart_format:true,
      language: 'id'
    }
  }
);


    res.json(response.data);
  } catch (error) {
    console.error("❌ Gagal memproses audio:", error.response?.data || error.message);
    res.status(500).json({ error: "Gagal memproses audio" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
