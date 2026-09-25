import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
export async function crypt(text,decrypt=false){
 const operation=decrypt?"$p=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))":"$p=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))";
 return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd();'+operation],{windowsHide:true,stdio:['pipe','pipe','ignore']});let out='';p.stdout.on('data',x=>out+=x);p.on('error',()=>reject(Error('Windows 암호화 실행 실패')));p.on('exit',c=>c===0&&out?resolve(out):reject(Error('Windows 암호화 처리 실패')));p.stdin.end(text);});
}
export async function readSecrets(file){return JSON.parse(await crypt(await fs.readFile(file,'utf8'),true));}
export async function writeSecrets(file,value){const encrypted=await crypt(JSON.stringify(value));await fs.writeFile(file+'.tmp',encrypted,{mode:0o600});await fs.rename(file+'.tmp',file);}
