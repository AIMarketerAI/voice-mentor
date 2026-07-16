require('dotenv').config();
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const fs = require('fs');

async function testVoice() {
  console.log('Testing ElevenLabs Connection...');

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.error('Error: Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in your .env file.');
    return;
  }

  const client = new ElevenLabsClient({ apiKey });

  try {
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text: 'Hello Mark! Your cloned voice integration for AI Mark is working perfectly.',
      modelId: 'eleven_multilingual_v2',
    });

    // Read the stream into a buffer and save it directly
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);
    fs.writeFileSync('test_output.mp3', content);

    console.log('Success! Audio generated and saved to test_output.mp3');
  } catch (error) {
    console.error('Error during voice generation:', error);
  }
}

testVoice();