(function(){
  /* ── Enter gate — present on the landing page only ── */
  var btn=document.querySelector('.enter-btn');
  var gate=document.getElementById('gate');
  if(btn&&gate){
    btn.addEventListener('click',function(){
      document.body.classList.add('entered');
      gate.style.opacity='0';
      gate.style.pointerEvents='none';
      setTimeout(function(){ gate.style.display='none'; },900);
    });
  }

  /* ── Mobile menu toggle ── */
  var mb=document.querySelector('.tb-menu-btn');
  var nav=document.querySelector('.tb-nav');
  if(mb&&nav){
    mb.addEventListener('click',function(){ nav.classList.toggle('open'); });
    nav.querySelectorAll('a').forEach(function(a){ a.addEventListener('click',function(){ nav.classList.remove('open'); }); });
  }

  /* ── Smooth scroll for genuine in-page anchors (ignores bare "#" and cross-page links) ── */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click',function(e){
      var href=this.getAttribute('href');
      if(!href||href.length<2) return;
      var t=document.querySelector(href);
      if(t){ e.preventDefault(); t.scrollIntoView({behavior:'smooth',block:'start'}); }
    });
  });

  /* ── Tree re-init shims (do not alter the tree script itself) ──
     The bundled script auto-inits on DOMContentLoaded; if that fired before the
     viewport had a size (canvas buffer 0), spin up a fresh tree once the canvas
     actually has dimensions. No-op in a normal full-size browser load. */
  window.addEventListener('load',function(){
    var tries=0;
    (function check(){
      var c=document.getElementById('growthCanvas');
      if(!c) return;
      var r=c.getBoundingClientRect();
      if(r.width>0 && r.height>0){
        if((c.width===0||c.height===0) && typeof LushTree==='function'){
          new LushTree('growthCanvas','treeOrigin');
        }
      } else if(tries<80){ tries++; setTimeout(check,100); }
    })();
  });

  /* The bundled resize handler stops the tree for good (incl. when Enter adds a
     scrollbar), so recreate it once a resize settles. */
  var rzTimer;
  window.addEventListener('resize',function(){
    clearTimeout(rzTimer);
    rzTimer=setTimeout(function(){
      var c=document.getElementById('growthCanvas');
      if(c && c.getBoundingClientRect().width>0 && typeof LushTree==='function'){
        new LushTree('growthCanvas','treeOrigin');
      }
    },260);
  });
})();
