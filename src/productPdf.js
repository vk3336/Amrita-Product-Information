export function downloadProductPdf(p) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${p.fabricCode}</title>
  <link rel="stylesheet" href="/src/pdf.css">
</head>
<body>

<div class="page">

  <!-- HEADER -->
  <header class="pdf-header">
    <img src="/logo1.png" class="logo" />
    <h1>Amrita Global Enterprise</h1>
  </header>
  <div class="gold-line"></div>

  <!-- TOP SECTION -->
  <section class="top-section">

    <!-- IMAGE COLUMN -->
    <div class="image-column">

      <!-- FABRIC CODE ABOVE IMAGE -->
      <div class="fabric-code" style="margin-left:15px !important">${p.fabricCode}</div>

      <div class="image-card">
        <img src="${p.image1CloudUrl}" />
        <span class="badge" style="margin-left:55px !important">48 Options</span>
      </div>

      <!-- SHORT DESCRIPTION BELOW IMAGE -->
      <p class="image-desc">
        ${p.shortProductDescription}
      </p>
    </div>

    <!-- INFO COLUMN -->
    <div class="info">

      <div class="tags">
        <span class="tag blue" style="margin-top:15px !important">${p.category}</span>
        <span class="tag green" style="margin-top:15px !important">${p.supplyModel}</span>
        <span class="stars" style="margin-top:15px !important">★★★★★</span>
      </div>

      <h2 style="font-size:180% !important">${p.productTitle}</h2>
      <p class="subtitle" style="font-size:115% !important">${p.productTagline}</p>

    </div>
  </section>

  <!-- SPEC TABLE -->
  <section class="specs">
    <div><b>CONTENT</b><span>${p.content.join(", ")}</span></div>
    <div><b>WIDTH</b><span>${p.cm} cm / ${p.inch} inch</span></div>
    <div><b>WEIGHT</b><span>${p.gsm} gsm / ${p.ozs} oz</span></div>
    <div><b>DESIGN</b><span>${p.design}</span></div>
    <div><b>STRUCTURE</b><span>${p.structure}</span></div>
    <div><b>COLORS</b><span>${p.color.join(", ")}</span></div>
    <div><b>MOTIF</b><span>N/A</span></div>
    <div><b>SALES MOQ</b><span>${p.salesMOQ} Meter</span></div>

    <div class="full">
      <b>FINISH</b>
      <span>${p.finish.join(", ")}</span>
    </div>
  </section>

  <!-- APPLICATIONS -->
  <section class="apps">
    <h3>Apparel :</h3>
    <ul>
      <li><b>Menswear:</b> Casual or short-sleeve shirts, kurtas and lounge pants.</li>
      <li><b>Womenswear:</b> Blouses, summer dresses, skirts, tunics, nightwear.</li>
      <li><b>Kids & Unisex:</b> Shirts, light dresses, pajamas.</li>
    </ul>

    <h3>Home & Accessories</h3>
    <ul>
      <li><b>Home:</b> Pillow & cushion covers, table runners.</li>
      <li><b>Accessories:</b> Pocket squares, scarves, trims.</li>
      <li><b>Work:</b> Indoor service uniforms.</li>
    </ul>
  </section>

  <!-- FOOTER -->
  <footer>
    <div class="footer-row">
      <span>📞 +91-9011234321</span>
      <span>💬 +91-8866791095</span>
      <span>✉️ connect.age.com</span>
    </div>
    <div class="address">
      404, Safal Prelude, Near SPIPA, Corporate Road, Ahmedabad, Gujarat 380015
    </div>
  </footer>

</div>

<script>
  window.onload = () => window.print();
</script>

</body>
</html>
`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}
