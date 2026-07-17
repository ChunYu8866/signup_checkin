const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });

  await page.goto('https://chunyu8866.github.io/signup_checkin/');
  
  await new Promise(r => setTimeout(r, 5000));
  
  const content = await page.content();
  if (content.includes('目前報到人數較多')) {
    console.log('DETECTED: 目前報到人數較多');
  } else {
    console.log('NOT DETECTED.');
  }

  await browser.close();
})();
