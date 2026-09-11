const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=__dirname,PUBLIC=path.join(ROOT,'public');
const DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'data'),DB_FILE=path.join(DATA_DIR,'db.json'),SEED_DB=path.join(ROOT,'data','db.json');
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(DB_FILE)){
  if(DB_FILE!==SEED_DB&&fs.existsSync(SEED_DB))fs.copyFileSync(SEED_DB,DB_FILE);
  else fs.writeFileSync(DB_FILE,JSON.stringify({settings:{durationMinutes:60},students:[],questions:[],attempts:[]},null,2));
}
const sessions=new Map();
const subjects=['Математика','Информатика','Физика','Химия','Биология','География','Қазақстан тарихы','Қазақ тілі мен әдебиеті','Орыс тілі мен әдебиеті','Қазақ мектебіндегі орыс тілі','Орыс мектебіндегі қазақ тілі','Ағылшын тілі'];
function db(){return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}function save(x){const tmp=DB_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x,null,2));fs.renameSync(tmp,DB_FILE)}
function out(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))}
function body(req){return new Promise((ok,bad)=>{let s='';req.on('data',d=>{s+=d;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){bad(e)}})})}
function token(req){return (req.headers.authorization||'').replace(/^Bearer /,'')}function admin(req){return sessions.get(token(req))==='admin'}
function cleanStudent(s){return {id:s.id,name:s.name,grade:s.grade,subject:s.subject,code:s.code}}
async function api(req,res,url){
  const d=db();
  if(req.method==='GET'&&url.pathname==='/api/config')return out(res,200,{settings:d.settings,subjects,grades:[5,6,7,8,9,10,11]});
  if(req.method==='POST'&&url.pathname==='/api/student/register'){
    const b=await body(req),name=String(b.name||'').trim(),grade=Number(b.grade),subject=String(b.subject||'');
    if(!name||![5,6,7,8,9,10,11].includes(grade)||!subjects.includes(subject))return out(res,400,{error:'Мәліметтерді дұрыс толтырыңыз'});
    let s=d.students.find(x=>x.name.toLowerCase()===name.toLowerCase()&&x.grade===grade&&x.subject===subject);
    if(!s){s={id:crypto.randomUUID(),name,grade,subject,code:'MO-'+Math.random().toString(36).slice(2,8).toUpperCase(),createdAt:new Date().toISOString()};d.students.push(s);save(d)}
    return out(res,200,cleanStudent(s));
  }
  if(req.method==='POST'&&url.pathname==='/api/student/login'){
    const b=await body(req),s=d.students.find(x=>x.code===String(b.code||'').trim().toUpperCase());if(!s)return out(res,401,{error:'Қатысу коды табылмады'});
    const t=crypto.randomBytes(24).toString('hex');sessions.set(t,s.id);return out(res,200,{token:t,student:cleanStudent(s)});
  }
  if(req.method==='GET'&&url.pathname==='/api/exam'){
    const sid=sessions.get(token(req)),s=d.students.find(x=>x.id===sid);if(!s)return out(res,401,{error:'Қайта кіріңіз'});
    const old=d.attempts.find(x=>x.studentId===s.id&&x.submittedAt);if(old)return out(res,409,{error:'Сіз тестті тапсырып қойдыңыз'});
    let a=d.attempts.find(x=>x.studentId===s.id&&!x.submittedAt);if(!a){a={id:crypto.randomUUID(),studentId:s.id,startedAt:new Date().toISOString(),answers:{}};d.attempts.push(a);save(d)}
    const qs=d.questions.filter(q=>q.grade===s.grade&&q.subject===s.subject).map(({correct,...q})=>q);
    return out(res,200,{attemptId:a.id,student:cleanStudent(s),durationMinutes:d.settings.durationMinutes,startedAt:a.startedAt,questions:qs});
  }
  if(req.method==='POST'&&url.pathname==='/api/exam/submit'){
    const sid=sessions.get(token(req)),s=d.students.find(x=>x.id===sid);if(!s)return out(res,401,{error:'Қайта кіріңіз'});const b=await body(req),a=d.attempts.find(x=>x.id===b.attemptId&&x.studentId===sid&&!x.submittedAt);if(!a)return out(res,409,{error:'Бұл тест жіберілген'});
    const qs=d.questions.filter(q=>q.grade===s.grade&&q.subject===s.subject);let score=0,total=0;for(const q of qs){total+=q.points||1;if(Number(b.answers?.[q.id])===q.correct)score+=q.points||1}Object.assign(a,{answers:b.answers||{},score,total,submittedAt:new Date().toISOString()});save(d);return out(res,200,{score,total,percent:total?Math.round(score/total*100):0});
  }
  if(req.method==='POST'&&url.pathname==='/api/admin/login'){const b=await body(req),adminPassword=process.env.ADMIN_PASSWORD||'Mektep2026!';if(b.login!=='admin'||b.password!==adminPassword)return out(res,401,{error:'Логин немесе құпиясөз қате'});const t=crypto.randomBytes(24).toString('hex');sessions.set(t,'admin');return out(res,200,{token:t})}
  if(url.pathname.startsWith('/api/admin/')&&!admin(req))return out(res,401,{error:'Әкімші ретінде кіріңіз'});
  if(req.method==='GET'&&url.pathname==='/api/admin/dashboard')return out(res,200,{settings:d.settings,students:d.students,questions:d.questions,attempts:d.attempts});
  if(req.method==='POST'&&url.pathname==='/api/admin/questions'){const b=await body(req);if(!b.text||!Array.isArray(b.options)||b.options.length<2)return out(res,400,{error:'Сұрақ толық емес'});d.questions.push({id:crypto.randomUUID(),grade:Number(b.grade),subject:b.subject,text:b.text,options:b.options,correct:Number(b.correct),points:Number(b.points)||1});save(d);return out(res,200,{ok:true})}
  if(req.method==='POST'&&url.pathname==='/api/admin/ai-generate'){
    if(!process.env.GEMINI_API_KEY)return out(res,400,{error:'GEMINI_API_KEY орнатылмаған. Railway → Variables бөліміне кілтті енгізіңіз'});
    const b=await body(req),grade=Number(b.grade),subject=String(b.subject||''),count=Math.min(30,Math.max(1,Number(b.count)||5)),language=b.language==='ru'?'орыс':'қазақ';
    if(![5,6,7,8,9,10,11].includes(grade)||!subjects.includes(subject))return out(res,400,{error:'Сынып пен пәнді таңдаңыз'});
    const schema={type:'object',properties:{questions:{type:'array',minItems:count,maxItems:count,items:{type:'object',properties:{text:{type:'string'},options:{type:'array',minItems:4,maxItems:4,items:{type:'string'}},correct:{type:'integer',minimum:0,maximum:3},explanation:{type:'string'}},required:['text','options','correct','explanation'],additionalProperties:false}}},required:['questions'],additionalProperties:false};
    const prompt=`Қазақстан мектебінің ${grade}-сыныбына арналған ${subject} пәнінен ${count} олимпиадалық тест сұрағын ${language} тілінде құрастыр. Оқу бағдарламасына сай, бірмәнді, жас ерекшелігіне лайық болсын. Әр сұрақта 4 нұсқа және бір ғана дұрыс жауап болсын. Фактілерді мұқият тексер.`;
    const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const rr=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'Сіз тәжірибелі пән мұғалімі және олимпиада тапсырмаларын құрастырушысыз.\n\n'+prompt}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,temperature:0.4}})});
    const data=await rr.json();
    if(!rr.ok)return out(res,502,{error:data.error?.message||'Gemini қызметі жауап бермеді'});
    const txt=data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('');
    if(!txt)return out(res,502,{error:data.promptFeedback?.blockReason?'Gemini сұранысты бұғаттады: '+data.promptFeedback.blockReason:'Gemini жауабы бос'});
    let parsed;try{parsed=JSON.parse(txt)}catch(e){return out(res,502,{error:'Gemini жауабын оқу мүмкін болмады. Қайта байқап көріңіз'})}
    const generated=(parsed.questions||[]).map(q=>({...q,id:crypto.randomUUID(),grade,subject,points:1,draft:true}));
    if(!generated.length)return out(res,502,{error:'Gemini сұрақтар дайындамады. Қайта байқап көріңіз'});
    d.questions.push(...generated);save(d);return out(res,200,{count:generated.length,questions:generated});
  }
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/admin/questions/')){d.questions=d.questions.filter(q=>q.id!==url.pathname.split('/').pop());save(d);return out(res,200,{ok:true})}
  if(req.method==='POST'&&url.pathname==='/api/admin/settings'){const b=await body(req);d.settings={...d.settings,...b,durationMinutes:Number(b.durationMinutes)||60};save(d);return out(res,200,d.settings)}
  return out(res,404,{error:'Табылмады'});
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){res.writeHead(200,{'content-type':'text/plain'});return res.end('ok')}if(url.pathname.startsWith('/api/'))return await api(req,res,url);let f=path.join(PUBLIC,url.pathname==='/'?'index.html':url.pathname);if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)}catch(e){console.error(e);out(res,500,{error:'Сервер қатесі'})}}).listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('MektepOlimp: http://localhost:'+(process.env.PORT||3000)));
