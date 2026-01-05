import { Storage } from '@meme-bot/storage';

const storage = new Storage();
const positions = storage.listOpenPositions();
console.log('Open positions', positions);
