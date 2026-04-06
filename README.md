<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>الأهرام</title>

<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">

<style>
body{font-family:Cairo;margin:0;background:#f5f7fa}
.header{height:160px;position:relative}
.header img{width:100%;height:100%;object-fit:cover}
.overlay{position:absolute;inset:0;background:rgba(0,0,0,0.4)}
.title{position:absolute;top:10px;right:10px;color:#fff}
.ticker{background:#E53935;color:#fff;padding:10px;text-align:center}
.search{width:90%;margin:10px auto;display:block;padding:10px}
.tiers{display:flex;flex-wrap:wrap;gap:5px;padding:10px}
.tiers button{flex:1;padding:8px;border:none;border-radius:20px;background:#0B3D91;color:#fff}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:10px}
.card{background:#fff;padding:10px;border-radius:12px}
.bottom{position:fixed;bottom:0;width:100%;background:#fff;display:flex;justify-content:space-between;padding:10px}
</style>

<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>

</head>

<body>

<div class="header">
<img id="img">
<div class="overlay"></div>
<div class="title">الأهرام للتجارة والتوزيع</div>
</div>

<div class="ticker" id="news">جاري التحميل...</div>

<input class="search" placeholder="بحث..." oninput="search(this.value)">

<div class="tiers" id="tiers"></div>
<div id="app"></div>

<div class="bottom">
<div id="total">0 جنيه</div>
<button onclick="review()">مراجعة</button>
</div>

<script>

let products=[],tiers=[],settings=[];
let cart={},tier=null;

/* تحميل CSV */
function loadCSV(url){
return new Promise((resolve)=>{
Papa.parse(url,{
download:true,
header:true,
skipEmptyLines:true,
complete:(res)=>resolve(res.data)
});
});
}

/* تحميل البيانات */
Promise.all([

/* PRODUCTS */
loadCSV("https://docs.google.com/spreadsheets/d/e/2PACX-1vTIBDH5bvuDjt6_VNA69Z5iSDfpnjtEQcyaRLSjxKhcoh6AEqYWBDu9rIrfwsYgZRDYcXtNcT4PeGcw/pub?gid=1311908073&output=csv"),

/* TIERS */
loadCSV("https://docs.google.com/spreadsheets/d/e/2PACX-1vTIBDH5bvuDjt6_VNA69Z5iSDfpnjtEQcyaRLSjxKhcoh6AEqYWBDu9rIrfwsYgZRDYcXtNcT4PeGcw/pub?gid=1316070187&output=csv"),

/* SETTINGS */
loadCSV("https://docs.google.com/spreadsheets/d/e/2PACX-1vTIBDH5bvuDjt6_VNA69Z5iSDfpnjtEQcyaRLSjxKhcoh6AEqYWBDu9rIrfwsYgZRDYcXtNcT4PeGcw/pub?gid=1273210397&output=csv")

]).then(([p,t,s])=>{

/* DEBUG مهم */
console.log("PRODUCTS:",p);

products = p.filter(x=>x.status && x.status.trim()==="active");
tiers = t.filter(x=>x.tier_active=="1");
settings = s;

/* HEADER */
let header = settings.find(x=>x.type==="company_image");
if(header) document.getElementById("img").src = header.value;

/* NEWS */
let newsList = settings.filter(x=>x.type==="news").map(x=>x.value);
let i=0;
setInterval(()=>{
document.getElementById("news").innerText=newsList[i]||"";
i=(i+1)%newsList.length;
},3000);

/* TIERS */
let c=document.getElementById("tiers");
tiers.forEach(t=>{
let b=document.createElement("button");
b.innerText=t.tier_name;
b.onclick=()=>{tier=t;showBrands();};
c.appendChild(b);
});

/* START */
showBrands();

});

/* BRANDS */
function showBrands(){
let app=document.getElementById("app");
app.innerHTML="";

let brands=[...new Set(products.map(p=>p.company))];

if(!brands.length){
app.innerHTML="<h3 style='text-align:center'>⚠️ لا يوجد منتجات</h3>";
return;
}

let grid=document.createElement("div");
grid.className="grid";

brands.forEach(b=>{
let c=document.createElement("div");
c.className="card";
c.innerHTML=`<h4>${b}</h4>`;
c.onclick=()=>showProducts(b);
grid.appendChild(c);
});

app.appendChild(grid);
}

/* PRODUCTS */
function showProducts(company){
let app=document.getElementById("app");
app.innerHTML=`<div onclick="showBrands()">⬅ رجوع</div>`;

let list=products.filter(p=>p.company==company);

let grid=document.createElement("div");
grid.className="grid";

list.forEach(p=>{
let c=document.createElement("div");
c.className="card";
c.innerHTML=`<h4>${p.name}</h4>`;
grid.appendChild(c);
});

app.appendChild(grid);
}

/* SEARCH */
function search(q){
if(!q) return showBrands();
let list=products.filter(p=>p.name?.includes(q));
let app=document.getElementById("app");
app.innerHTML="";
list.forEach(p=>{
let c=document.createElement("div");
c.className="card";
c.innerHTML=`<h4>${p.name}</h4>`;
app.appendChild(c);
});
}

/* REVIEW */
function review(){
alert("تم");
}

</script>

</body>
</html>
