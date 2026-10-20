(() => {
 const el=id=>document.getElementById(id);
 const client=window.supabase.createClient("https://pmdgnhkbmarvtvfprdsy.supabase.co","sb_publishable_XVoP3QTblvFdhjs157vaWQ_yXTaYtE8");
 let generation=0, allowed=false, loading=false, ownerId=null;
 function lock(){
  generation++; allowed=false; ownerId=null; loading=false; el("refresh").disabled=false;
  el("rows").replaceChildren(); el("counter").textContent="";
  el("dashboard").classList.add("hidden"); el("gate").classList.remove("hidden");
  el("status").textContent="Avval kundalik sahifasidan akkauntingizga kiring.";
 }
 async function refresh(){
  if(!allowed||loading)return;
  const seq=generation; loading=true; el("refresh").disabled=true;
  el("counter").textContent="Yuklanmoqda...";
  try{
   const {data,error}=await client.rpc("admin_diary_users");
   if(seq!==generation||!allowed)return;
   if(error)throw error;
   el("rows").replaceChildren();
   el("counter").textContent=(data||[]).length+" ta foydalanuvchi"+((data||[]).length===500?" (oxirgi 500 ta ko‘rsatilgan)":"");
   for(const u of data||[]){
    const tr=document.createElement("tr");
    for(const val of [u.email||"—",u.joined_at?new Date(u.joined_at).toLocaleString("uz-UZ"):"—",u.last_seen_at?new Date(u.last_seen_at).toLocaleString("uz-UZ"):"—",u.email_verified?"Ha":"Yo‘q"]){
     const td=document.createElement("td");td.textContent=val;tr.append(td);
    }
    el("rows").append(tr);
   }
  }catch(err){if(seq===generation&&allowed){el("rows").replaceChildren();el("counter").textContent="Xatolik: "+(err.message||"Yuklanmadi.");}}
  finally{if(seq===generation){loading=false;el("refresh").disabled=false;}}
 }
 async function checkOwner(){
  const seq=++generation;
  try{
   const {data,error}=await client.auth.getUser();
   if(seq!==generation)return;
   if(error||!data?.user)throw new Error("Avval kundalik sahifasidan akkauntingizga kiring.");
   const admin=await client.rpc("am_i_diary_admin");
   if(seq!==generation)return;
   if(admin.error||admin.data!==true)throw new Error("Administrator huquqi yo‘q.");
   ownerId=data.user.id;allowed=true;el("gate").classList.add("hidden");el("dashboard").classList.remove("hidden");
   await refresh();
  }catch(err){if(seq===generation){lock();el("status").textContent=err.message||"Ruxsat berilmadi.";}}
 }
 el("refresh").addEventListener("click",refresh);
 client.auth.onAuthStateChange((event,session)=>{
  if(!session)lock();
  else if(event==="SIGNED_IN"&&session.user.id!==ownerId){lock();setTimeout(checkOwner,0);}
 });
 checkOwner();
})();

