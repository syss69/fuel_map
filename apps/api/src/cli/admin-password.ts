import { hashPassword } from '../admin/password';

async function main() {
  if (!process.stdin.isTTY) throw new Error('Un terminal interactif est nécessaire.');
  process.stdout.write('Mot de passe administrateur (12 caractères minimum) : ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  const password = await new Promise<string>((resolve, reject) => {
    let value = '';
    const listener = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\r' || character === '\n') {
          process.stdin.off('data', listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          if (character === '\u0003') reject(new Error('Annulé')); else resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', listener);
  });
  if (password.length < 12 || password.length > 256) throw new Error('Utilisez entre 12 et 256 caractères.');
  console.log(`ADMIN_PASSWORD_HASH='${await hashPassword(password)}'`);
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
