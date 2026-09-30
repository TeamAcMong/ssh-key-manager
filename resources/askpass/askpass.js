// SSH_ASKPASS helper. OpenSSH runs it with the prompt as argv; it asks the SSH Key Manager
// process for the answer over the named pipe given in SKM_ASKPASS_PIPE and prints it on stdout.
// It never logs anything and exits non-zero (= "cancelled") on any problem.
'use strict';
const net = require('node:net');

const pipe = process.env.SKM_ASKPASS_PIPE;
const token = process.env.SKM_ASKPASS_TOKEN;
if (!pipe || !token) process.exit(1);

const prompt = process.argv.slice(2).join(' ');
const sock = net.connect(pipe, () => sock.write(JSON.stringify({ token, prompt }) + '\n'));
let buf = '';
sock.setEncoding('utf8');
sock.setTimeout(120000, () => process.exit(1));
sock.on('data', (d) => (buf += d));
sock.on('error', () => process.exit(1));
sock.on('end', () => {
  try {
    const reply = JSON.parse(buf);
    if (typeof reply.answer === 'string') {
      process.stdout.write(reply.answer + '\n', () => process.exit(0));
      return;
    }
  } catch {
    // fall through
  }
  process.exit(1);
});
