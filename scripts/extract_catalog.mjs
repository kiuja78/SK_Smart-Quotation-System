/** Extract the SK-owned month archive with a minimal VM context. Input: data.js on stdin. */
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(0,'utf8');
const sandbox={window:Object.create(null)};
vm.runInNewContext(code,sandbox,{timeout:12000,filename:'source-data.js'});
const archive=sandbox.window.SK_MONTH_ARCHIVE||sandbox.SK_MONTH_ARCHIVE;
if(!archive||typeof archive!=='object'||!Object.keys(archive).length)throw Error('SK_MONTH_ARCHIVE 데이터가 없습니다.');
process.stdout.write(JSON.stringify(archive));
