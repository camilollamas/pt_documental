// Genera el valor de ADMIN_PASSWORD_HASH. Uso: npm run hash-password
// La contraseña se pide sin mostrarla, para que no quede en pantalla ni en el historial de la terminal.
import bcrypt from 'bcryptjs';
import { stdin, stdout } from 'node:process';

const MIN_LENGTH = 12;
const MAX_BYTES = 72; // bcrypt ignora lo que pase de 72 bytes
const COST = 12;

function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  if (!stdin.isTTY) {
    // Entrada redirigida (CI o scripts): se lee la primera línea.
    return new Promise((resolve) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0]));
    });
  }
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (char === '\u0003') process.exit(130); // Ctrl+C
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await readHidden('Contraseña del administrador: ');
if (password.length < MIN_LENGTH) {
  console.error(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
  process.exit(1);
}
if (Buffer.byteLength(password) > MAX_BYTES) {
  console.error(`La contraseña no puede superar ${MAX_BYTES} bytes (límite de bcrypt).`);
  process.exit(1);
}
if (stdin.isTTY && (await readHidden('Repítela: ')) !== password) {
  console.error('Las contraseñas no coinciden.');
  process.exit(1);
}

// Comillas simples: el hash contiene "$" y así ni Docker Compose ni la shell intentan interpolarlo.
console.log(`\nAñade esta línea a backend/.env:\nADMIN_PASSWORD_HASH='${await bcrypt.hash(password, COST)}'`);
