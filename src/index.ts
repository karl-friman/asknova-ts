//index.ts
import { ChatCompletionRequestMessageRoleEnum, Configuration, OpenAIApi } from "openai";

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import express, { Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import multer from "multer";

interface Voice {
  id: string;
  name: string;
}

interface Message {
  role: ChatCompletionRequestMessageRoleEnum;
  content: string;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + ".webm");
  },
});

const upload = multer({ storage });

dotenv.config({ path: ".env.local" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_STABILITY = 0.75;
const ELEVENLABS_VOICE_SIMILARITY = 0.9;
let ELEVENLABS_ALL_VOICES: Voice[] = [];

if (!ELEVENLABS_API_KEY || !OPENAI_API_KEY) {
  console.error(
    "Missing API keys. Please set the ELEVENLABS_API_KEY and OPENAI_API_KEY environment variables."
  );
  process.exit(1);
}

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const app = express();
app.use(express.static("public"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function getVoices(): Promise<Voice[]> {
  const url = "https://api.elevenlabs.io/v1/voices";
  const headers = {
    "xi-api-key": ELEVENLABS_API_KEY,
  };

  try {
    const response = await axios.get(url, { headers });

    return response.data["voices"];
  } catch (error) {
    console.error("Error fetching ElevenLabs voices:", error);
    return [];
  }
}

async function generateReply(conversation: Message[]): Promise<string> {
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: "You are a helpful assistant." }, ...conversation],
    });
    return completion?.data?.choices[0]?.message?.content || "No completion text available.";
  } catch (error) {
    console.error("Error generating ChatGPT reply:", error);
    return "";
  }
}

async function generateAudio(
  text: string,
  voice_id: string,
  output_path: string = ""
): Promise<string> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`;
  const headers = {
    "xi-api-key": ELEVENLABS_API_KEY,
    "content-type": "application/json",
  };
  const data = {
    text,
    voice_settings: {
      stability: ELEVENLABS_VOICE_STABILITY,
      similarity_boost: ELEVENLABS_VOICE_SIMILARITY,
    },
  };

  try {
    const response = await axios.post(url, data, { headers, responseType: "arraybuffer" }); // Set responseType to 'arraybuffer'
    const audioBuffer = Buffer.from(response.data); // Create a Buffer from the binary data
    await fs.promises.writeFile(output_path, audioBuffer); // Write binary buffer to file
    return output_path;
  } catch (error) {
    console.error("Error generating audio:", error);
    return "";
  }
}

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/transcribe", upload.single("file"), async (req: any, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send("No file found");
  }

  //convert the file to a file
  const recording_file = `${uuidv4()}.wav`;
  const recording_path = path.join("uploads", recording_file);
  fs.mkdirSync(path.dirname(recording_path), { recursive: true });

  try {
    const response = await openai.createTranscription(
      fs.createReadStream(file.path) as any, // The audio file to transcribe.
      "whisper-1", // The model to use for transcription.
      undefined, // The prompt to use for transcription.
      "json", // The format of the transcription.
      0.8, // Temperature
      "en" // Language
    );
    res.json(
      {
        text: `${response?.data?.text}`,
      } || { text: `No transcription text available.` }
    );
  } catch (error) {
    console.log("Error:", error);
  }
});

app.get("/voices", (_req: Request, res: Response) => {
  res.json(ELEVENLABS_ALL_VOICES);
});

app.post("/ask", async (req: Request, res: Response) => {
  const conversation = req.body.conversation || [];
  const voice_id = req.body.voice_id || "";
  const reply = await generateReply(conversation);
  const reply_file = `${uuidv4()}.mp3`;
  const reply_path = path.join("public/outputs", reply_file);
  fs.mkdirSync(path.dirname(reply_path), { recursive: true });

  await generateAudio(reply, voice_id, reply_path);
  res.json({ text: reply, audio: `/outputs/${reply_file}` });
});

app.get("/listen/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "outputs", filename);
  res.sendFile(filePath);

  res.sendFile(filePath);
});

(async () => {
  if (ELEVENLABS_API_KEY) {
    ELEVENLABS_ALL_VOICES = await getVoices();
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
  });
})();
