import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
const idx=JSON.parse(fs.readFileSync("data/routing-index.json","utf8"));
const nameBy=new Map(idx.map(e=>[e.slug,e.name]));
const bg=s=>{const o=new Set();const t=s.replace(/\s/g,"");for(let i=0;i<t.length-1;i++)o.add(t.slice(i,i+2));return o;};
const BLOB=new Map(idx.map(e=>[e.slug,bg(`${e.name}${e.oneLiner}${e.applicability}${e.category}`)]));
const pre=q=>{const Q=bg(q);return idx.map(e=>{const B=BLOB.get(e.slug);let n=0;for(const g of Q)if(B.has(g))n++;return{e,s:n/Q.size};}).sort((a,b)=>b.s-a.s);};
const et=e=>[`slug: ${e.slug}`,`이름: ${e.name}`,`분류: ${e.category}`,`요약: ${e.oneLiner}`,e.applicability?`적용대상: ${e.applicability}`:"",e.related.length?`연결된 제도: ${e.related.map(s=>nameBy.get(s)).join(", ")}`:""].filter(Boolean).join("\n");
const arts=s=>s.flatMap(x=>JSON.parse(fs.readFileSync(`public/articles/${x}.json`,"utf8")));
const flat=s=>s.replace(/\s+/g,"");
const anth=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,baseURL:process.env.ANTHROPIC_BASE_URL,defaultHeaders:{"cf-aig-authorization":`Bearer ${process.env.CF_AI_GATEWAY_TOKEN}`}});
const call=async(m,sys,u,sc,mt)=>{const eff=/^claude-(opus|sonnet|fable)/.test(m);
  const r=await anth.messages.create({model:m,max_tokens:mt,thinking:{type:"disabled"},output_config:{...(eff?{effort:"low"}:{}),format:{type:"json_schema",schema:sc}},system:sys,messages:[{role:"user",content:u}]});
  return {j:JSON.parse(r.content.find(b=>b.type==="text").text),u:r.usage};};
const S1=c=>({type:"object",properties:{candidates:{type:"array",items:{type:"string",enum:c}}},required:["candidates"],additionalProperties:false});
const S2=k=>({type:"object",properties:{claims:{type:"array",items:{type:"object",properties:{text:{type:"string"},quote:{type:"string"},article:{type:"string",enum:k}},required:["text","quote","article"],additionalProperties:false}},needsMoreInfo:{type:"boolean"}},required:["claims","needsMoreInfo"],additionalProperties:false});
const RULES=`아래 조문 원문에 **실제로 적힌 내용만** 근거로 답하십시오.
각 claim은 셋: text(보일 문장) / quote(근거 구절을 원문에서 글자 그대로 복사, 요약 금지) / article(조문 키).
원문에 없는 수치·기한·요건 금지. 뒷받침 안 되면 claim에서 뺄 것. 4~6개.`;
const QS=JSON.parse(fs.readFileSync("scripts/eval/questions.json","utf8"));
const PRICE={"claude-sonnet-5":{i:2,o:10},"claude-haiku-4-5":{i:1,o:5}};
const out=[];
for(const model of ["claude-sonnet-5","claude-haiku-4-5"]){
  let hit=0,any=0,kept=0,drop=0,ti=0,to=0,n=0,oos=0;
  for(const t of QS){
    try{
      const sc=pre(t.q); if(sc[0].s<0.12){oos++;continue;}
      const sub=sc.slice(0,15).map(x=>x.e);
      const r1=await call(model,`공공조달 제도 목록에서 사용자 상황에 해당하는 제도를 최대 3개, 관련성 순으로 고르십시오.\n\n${sub.map(et).join("\n---\n")}`,t.q,S1(sub.map(e=>e.slug)),256);
      const picked=(r1.j.candidates||[]).slice(0,3); if(!picked.length){oos++;continue;}
      const A=arts(picked);
      const r2=await call(model,`${RULES}\n\n조문 원문:\n\n${A.map(a=>`[${a.key}] ${a.title}\n${a.text}`).join("\n\n")}`,t.q,S2(A.map(a=>a.key)),2048);
      const byK=new Map(A.map(a=>[a.key,a]));let k=0,d=0;
      for(const c of (r2.j.claims||[])){const a=byK.get(c.article);
        if(a&&flat(c.quote||"").length>=12&&flat(a.text).includes(flat(c.quote)))k++;else d++;}
      n++;kept+=k;drop+=d;ti+=r1.u.input_tokens+r2.u.input_tokens;to+=r1.u.output_tokens+r2.u.output_tokens;
      if(t.ok.includes(picked[0]))hit++; if(picked.some(s=>t.ok.includes(s)))any++;
      console.log(`  ${model} | ${t.q.slice(0,22)} → ${nameBy.get(picked[0])} ${t.ok.includes(picked[0])?"O":"X"} | 통과${k}/폐기${d}`);
    }catch(e){console.log(`  [오류] ${t.q}: ${String(e.message).slice(0,80)}`);}
  }
  const p=PRICE[model];
  out.push(`■ ${model}
  1순위 적중  ${hit}/${n} (${(hit/n*100).toFixed(0)}%)
  후보내 적중 ${any}/${n} (${(any/n*100).toFixed(0)}%)
  근거 대조   통과 ${kept} / 폐기 ${drop} (통과율 ${(kept/(kept+drop)*100).toFixed(1)}%)
  범위밖      ${oos}건
  질의당      ${(((ti/1e6*p.i)+(to/1e6*p.o))*1400/n).toFixed(1)}원 (in ${Math.round(ti/n)}/out ${Math.round(to/n)})`);
}
console.log("\n"+"=".repeat(50));
console.log(out.join("\n\n"));
