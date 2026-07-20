// 제공자별 성능 비교. 실제 2단계 파이프라인과 같은 절차로 돌린다.
// 재는 것: 1순위 적중 / 근거 대조 통과율 / 지연 / 비용
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
const idx=JSON.parse(fs.readFileSync("data/routing-index.json","utf8"));
const nameBy=new Map(idx.map(e=>[e.slug,e.name]));
const bg=s=>{const o=new Set();const t=s.replace(/\s/g,"");for(let i=0;i<t.length-1;i++)o.add(t.slice(i,i+2));return o;};
const BLOB=new Map(idx.map(e=>[e.slug,bg(`${e.name}${e.oneLiner}${e.applicability}${e.category}`)]));
const pre=q=>{const Q=bg(q);return idx.map(e=>{const b=BLOB.get(e.slug);let n=0;for(const g of Q)if(b.has(g))n++;return{e,s:n/Q.size};}).sort((a,b)=>b.s-a.s);};
const et=e=>[`slug: ${e.slug}`,`이름: ${e.name}`,`분류: ${e.category}`,`요약: ${e.oneLiner}`,e.applicability?`적용대상: ${e.applicability}`:"",e.related.length?`연결된 제도: ${e.related.map(s=>nameBy.get(s)).join(", ")}`:""].filter(Boolean).join("\n");
const arts=s=>s.flatMap(x=>JSON.parse(fs.readFileSync(`public/articles/${x}.json`,"utf8")).articles);
const flat=s=>s.replace(/\s+/g,"");
const S1=c=>({type:"object",properties:{candidates:{type:"array",items:{type:"string",enum:c}}},required:["candidates"],additionalProperties:false});
const S2=k=>({type:"object",properties:{claims:{type:"array",items:{type:"object",properties:{text:{type:"string"},quote:{type:"string"},article:{type:"string",enum:k}},required:["text","quote","article"],additionalProperties:false}},needsMoreInfo:{type:"boolean"}},required:["claims","needsMoreInfo"],additionalProperties:false});
const RULES=`아래 조문 원문에 **실제로 적힌 내용만** 근거로 답하십시오.
각 claim은 셋: text(보일 문장) / quote(근거 구절을 원문에서 글자 그대로 복사, 요약 금지) / article(조문 키).
원문에 없는 수치·기한·요건 금지. 뒷받침 안 되면 claim에서 뺄 것. 4~6개.`;

const anth=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,baseURL:process.env.ANTHROPIC_BASE_URL,defaultHeaders:{"cf-aig-authorization":`Bearer ${process.env.CF_AI_GATEWAY_TOKEN}`}});
const extractJson=raw=>{const f=raw.match(/```(?:json)?\s*([\s\S]*?)```/);const b=f?f[1]:raw;
  try{return JSON.parse(b.trim());}catch{}
  const i=b.indexOf("{"),j=b.lastIndexOf("}");
  if(i>=0&&j>i)return JSON.parse(b.slice(i,j+1)); throw new Error("no json");};

const PROVIDERS={
 "nvidia-ultra":{price:[0,0],call:async(sys,u,sc,mt)=>{
   let r;for(let a=0;a<3;a++){r=await fetch("https://integrate.api.nvidia.com/v1/chat/completions",{method:"POST",
     headers:{Authorization:"Bearer "+process.env.NVIDIA_API_KEY,"Content-Type":"application/json"},
     body:JSON.stringify({model:"nvidia/nemotron-3-ultra-550b-a55b",max_tokens:mt*2,temperature:0,
       chat_template_kwargs:{enable_thinking:false,force_nonempty_content:true},
       messages:[{role:"system",content:sys},{role:"user",content:u}],
       response_format:{type:"json_schema",json_schema:{name:"r",schema:sc,strict:true}}})});
     if(r.status!==503)break; await new Promise(x=>setTimeout(x,400*(a+1)));}
   if(!r.ok)throw new Error("nvidia "+r.status+" "+(await r.text()).slice(0,150));
   const d=await r.json();return{j:extractJson(d.choices?.[0]?.message?.content||""),u:{i:d.usage?.prompt_tokens||0,o:d.usage?.completion_tokens||0}};}},
 "gemini-lite":{price:[0,0],call:async(sys,u,sc,mt)=>{
   const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",{method:"POST",
     headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"Content-Type":"application/json"},
     body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{parts:[{text:u}]}],
       generationConfig:{responseMimeType:"application/json",responseJsonSchema:sc,maxOutputTokens:mt}})});
   if(!r.ok)throw new Error("gemini "+r.status+" "+(await r.text()).slice(0,150));
   const d=await r.json();const t=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
   return{j:extractJson(t),u:{i:d.usageMetadata?.promptTokenCount||0,o:d.usageMetadata?.candidatesTokenCount||0}};}},
 "haiku":{price:[1,5],call:async(sys,u,sc,mt)=>{
   const m=await anth.messages.create({model:"claude-haiku-4-5",max_tokens:mt,thinking:{type:"disabled"},
     output_config:{format:{type:"json_schema",schema:sc}},system:sys,messages:[{role:"user",content:u}]});
   return{j:JSON.parse(m.content.find(b=>b.type==="text").text),u:{i:m.usage.input_tokens,o:m.usage.output_tokens}};}},
};

const QS=JSON.parse(fs.readFileSync("scripts/eval/questions.json","utf8"));
for(const [name,P] of Object.entries(PROVIDERS)){
  let hit=0,kept=0,drop=0,ti=0,to=0,n=0,fail=0,ms=0;
  for(const t of QS){
    const t0=Date.now();
    try{
      const sub=pre(t.q).slice(0,15).map(x=>x.e);
      const r1=await P.call(`공공조달 제도 목록에서 사용자 상황에 해당하는 제도를 최대 3개, 관련성 순으로 고르십시오.\n\n${sub.map(et).join("\n---\n")}`,t.q,S1(sub.map(e=>e.slug)),256);
      const picked=(r1.j.candidates||[]).filter(s=>nameBy.has(s)).slice(0,3);
      if(!picked.length){fail++;continue;}
      const A=arts(picked);
      const r2=await P.call(`${RULES}\n\n조문 원문:\n\n${A.map(a=>`[${a.key}] ${a.title}\n${a.text}`).join("\n\n")}`,t.q,S2(A.map(a=>a.key)),2048);
      const byK=new Map(A.map(a=>[a.key,a]));let k=0,d=0;
      for(const c of (r2.j.claims||[])){const a=byK.get(c.article);
        if(a&&flat(c.quote||"").length>=12&&flat(a.text).includes(flat(c.quote)))k++;else d++;}
      n++;kept+=k;drop+=d;ms+=Date.now()-t0;
      ti+=r1.u.i+r2.u.i;to+=r1.u.o+r2.u.o;
      if(t.ok.includes(picked[0]))hit++;
    }catch(e){fail++;console.log(`  [${name}] 실패: ${t.q.slice(0,18)} — ${String(e.message).slice(0,80)}`);}
  }
  const won=n?(((ti/1e6*P.price[0])+(to/1e6*P.price[1]))*1400/n):0;
  console.log(`\n■ ${name}`);
  console.log(`  1순위 적중   ${hit}/${n||1}  (${n?(hit/n*100).toFixed(0):0}%)   실패 ${fail}건`);
  console.log(`  근거 통과율  ${kept}/${kept+drop}  (${kept+drop?(kept/(kept+drop)*100).toFixed(1):0}%)`);
  console.log(`  평균 지연    ${n?(ms/n/1000).toFixed(1):0}초`);
  console.log(`  질의당 비용  ${P.price[0]?won.toFixed(1)+"원":"무료"}`);
}
