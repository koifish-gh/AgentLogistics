import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
const root='E:/code/AgentLogistics';
const child=spawn('C:/Windows/System32/OpenSSH/ssh.exe',['-T','-o','StrictHostKeyChecking=accept-new','-o',`UserKnownHostsFile=${root}/.tools/tunnel-known-hosts`,'-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-o','ExitOnForwardFailure=yes','-R','80:127.0.0.1:8788','nokey@localhost.run'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
// Keep stdin open: the anonymous tunnel is tied to the SSH session, not just the process.
child.stdout.pipe(createWriteStream(`${root}/output/public-tunnel.stdout.log`));
child.stderr.pipe(createWriteStream(`${root}/output/public-tunnel.stderr.log`));
child.on('exit',code=>process.exit(code??1));
child.on('error',()=>process.exit(1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill();process.exit(0);});
