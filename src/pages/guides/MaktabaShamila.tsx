import { Link } from "react-router-dom";
import PublicLayout from "@/components/PublicLayout";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * SEO guide: /guides/maktaba-shamila-tutorial (+ /ur, /ar mirrors).
 * Targets the keyword "مکتبہ شاملہ" / "Maktaba Shamila".
 */
export default function MaktabaShamilaGuide() {
  const { language, direction } = useLanguage();
  const isAr = language === "ar";
  const isUr = language === "ur";

  const title = isAr
    ? "المكتبة الشاملة: دليل شامل للباحث المسلم مع الذكاء الاصطناعي"
    : isUr
    ? "مکتبہ شاملہ کا مکمل رہنما — AI کے ساتھ اسلامی تحقیق کیسے کریں"
    : "Maktaba Shamila (المكتبة الشاملة) — A Complete Guide for Modern Islamic Research with AI";

  const description = isAr
    ? "شرح مفصّل لاستخدام المكتبة الشاملة في البحث الشرعي: التثبيت، طرق البحث، ودمجها مع أدوات الذكاء الاصطناعي مثل Al-Ulama Easy Editor."
    : isUr
    ? "مکتبہ شاملہ کی تنصیب، جستجو کی تکنیکس، اور AI ٹولز (Al-Ulama Easy Editor) کے ساتھ اسے استعمال کرنے کا مکمل عملی رہنما۔"
    : "Learn how to install and search Maktaba Shamila (The Comprehensive Library) for Islamic research, and combine it with AI tools like Al-Ulama Easy Editor for citation-grounded results.";

  useSeo({ title: `${title} — Al-Ulama Easy Editor`, description, path: "/guides/maktaba-shamila-tutorial" });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    inLanguage: isAr ? "ar" : isUr ? "ur" : "en",
    author: { "@type": "Organization", name: "Al-Ulama" },
    publisher: { "@type": "Organization", name: "Al-Ulama Easy Editor" },
    datePublished: "2026-07-02",
    dateModified: "2026-07-02",
  };

  return (
    <PublicLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article dir={direction} className="mx-auto max-w-3xl px-4 py-12 prose prose-neutral dark:prose-invert prose-headings:scroll-mt-20 prose-h2:mt-10 prose-h2:text-2xl prose-h3:text-xl prose-a:text-primary">
        <h1>{title}</h1>

        {isAr ? <ArabicBody /> : isUr ? <UrduBody /> : <EnglishBody />}

        <hr className="my-10" />
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "مزيد من الأدلة: "
            : isUr
            ? "مزید رہنما: "
            : "Related: "}
          <Link to="/faq/is-ai-haram-in-islam">
            {isAr ? "هل الذكاء الاصطناعي حرام؟" : isUr ? "کیا AI حرام ہے؟" : "Is AI haram in Islam?"}
          </Link>
          {" · "}
          <Link to="/about">{isAr ? "من نحن" : isUr ? "ہمارے بارے میں" : "About"}</Link>
        </p>
      </article>
    </PublicLayout>
  );
}

function EnglishBody() {
  return (
    <>
      <p>
        <strong>Maktaba Shamila</strong> (المكتبة الشاملة, "The Comprehensive Library") is the
        largest free digital library of classical Arabic Islamic texts — over 7,000 titles
        covering tafsīr, hadith, fiqh, ʿaqīdah, sīrah, and language sciences. This guide walks
        you through installing it, searching it effectively, and combining it with modern AI
        tools like Al-Ulama Easy Editor for citation-grounded research.
      </p>

      <h2>1. What is Maktaba Shamila?</h2>
      <p>
        Developed by <em>al-Maktabah al-Shāmilah</em> and maintained by volunteers, Shamela
        indexes and searches full-text Arabic works with madh-hab, era, and topic filters.
        Most students of knowledge use it as their first reference before consulting a printed
        muṣḥaf or maṭbūʿ edition.
      </p>

      <h2>2. Installing Shamela on Windows / macOS / Linux</h2>
      <ol>
        <li>Download the latest release from <a href="https://shamela.ws" rel="noopener">shamela.ws</a>.</li>
        <li>On macOS or Linux, run it under <a href="https://www.winehq.org" rel="noopener">Wine</a> or use the community <a href="https://waqfeya.net" rel="noopener">Waqfeya</a> web viewer.</li>
        <li>Open <em>Settings → Library Path</em> and point it to a folder with 20+ GB free.</li>
        <li>Use the built-in downloader to fetch the categories you need (start with <em>Tafsīr</em>, <em>Ḥadīth</em>, <em>Fiqh</em>).</li>
      </ol>

      <h3>Mobile alternatives</h3>
      <p>
        On iOS and Android, use the <em>Shamela Mobile</em> or <em>Maktaba Shamila</em> apps.
        They read the same book format (<code>.bok</code> / <code>.epub</code>) and sync
        bookmarks across devices.
      </p>

      <h2>3. Search techniques that actually work</h2>
      <ul>
        <li><strong>Root search</strong> — Shamela strips prefixes/suffixes, so searching <code>ذكر</code> also matches <code>الذاكرين</code>, <code>مذكور</code>, etc.</li>
        <li><strong>Phrase search</strong> — wrap in quotes: <code>"إنما الأعمال بالنيات"</code>.</li>
        <li><strong>Book filter</strong> — narrow to Ṣaḥīḥ al-Bukhārī, Musnad Aḥmad, or any single title before searching.</li>
        <li><strong>Diacritics</strong> — searches are diacritic-insensitive by default; you don't need to type ḥarakāt.</li>
        <li><strong>Regex / boolean</strong> — advanced search supports <code>AND</code>, <code>OR</code>, <code>NOT</code> operators.</li>
      </ul>

      <h2>4. Combining Shamela with AI (Al-Ulama Easy Editor)</h2>
      <p>
        Shamela is unmatched at raw retrieval, but it can't summarise, translate to Urdu, or
        verify a citation across multiple Sunan. That is where an AI research assistant
        grounded in Qurʾān and Ḥadīth helps:
      </p>
      <ol>
        <li>Search Shamela for the passage you need — copy the Arabic quotation.</li>
        <li>Paste it into <Link to="/research">Al-Ulama Easy Editor's Research mode</Link>. The AI returns a citation-verified answer with Qurʾān / Ḥadīth references, plus Urdu and English translations.</li>
        <li>For images of printed Shamela pages, use <Link to="/ocr">OCR</Link> to extract Arabic text, then feed it to Research or Translate.</li>
        <li>Use <Link to="/speak">Speak</Link> to have the passage read aloud in a natural Arabic voice for memorisation.</li>
      </ol>

      <h2>5. Verifying citations — a small madrasah workflow</h2>
      <p>
        Never rely on a single tool. The safe workflow for a student of knowledge is:
      </p>
      <ol>
        <li>Find the passage in Shamela → note the book, volume, and page.</li>
        <li>Run Research mode in Easy Editor → confirm the wording and grade (<em>ṣaḥīḥ</em>, <em>ḥasan</em>, <em>ḍaʿīf</em>) against multiple compilers.</li>
        <li>Cross-check against a printed edition (Dār al-Salām, Dār al-Minhāj) before publishing.</li>
      </ol>

      <h2>6. Frequently asked questions</h2>
      <h3>Is Maktaba Shamila free?</h3>
      <p>Yes — the desktop app and full library are free. Al-Ulama Easy Editor is freemium with a Pro tier.</p>
      <h3>Does Shamela have Urdu or English books?</h3>
      <p>Shamela is Arabic-only. For Urdu and English, use Easy Editor's translation and research features.</p>
      <h3>How large is the full library?</h3>
      <p>Roughly 20–25 GB fully downloaded; you can install only the categories you need.</p>

      <p className="mt-8">
        Ready to try it? <Link to="/signup">Create a free Al-Ulama Easy Editor account</Link> and
        paste your first Shamela passage into Research.
      </p>
    </>
  );
}

function UrduBody() {
  return (
    <>
      <p>
        <strong>مکتبہ شاملہ</strong> (المكتبة الشاملة) عربی اسلامی کتب کی سب سے بڑی مفت ڈیجیٹل
        لائبریری ہے — 7,000 سے زائد کتب پر مشتمل، جن میں تفسیر، حدیث، فقہ، عقیدہ، سیرت اور
        علومِ لسان شامل ہیں۔ یہ مضمون اس کی تنصیب، جستجو کے طریقے، اور جدید AI ٹولز
        (Al-Ulama Easy Editor) کے ساتھ اس کے استعمال پر مکمل عملی رہنمائی فراہم کرتا ہے۔
      </p>

      <h2>1. مکتبہ شاملہ کیا ہے؟</h2>
      <p>
        شاملہ عربی کتب کو مکمل متن (full-text) کے ساتھ انڈیکس کرتی ہے اور مسلک، دور اور
        موضوع کے فلٹرز کے ساتھ جستجو کی سہولت دیتی ہے۔ آج طلبۂ علم و علماء کی اکثریت اسی
        سے ابتدائی حوالہ نکالتی ہے۔
      </p>

      <h2>2. Windows / macOS / Linux پر تنصیب</h2>
      <ol>
        <li>تازہ ورژن <a href="https://shamela.ws" rel="noopener">shamela.ws</a> سے ڈاؤن لوڈ کریں۔</li>
        <li>macOS یا Linux پر <a href="https://www.winehq.org" rel="noopener">Wine</a> استعمال کریں یا <a href="https://waqfeya.net" rel="noopener">Waqfeya</a> کا ویب ورژن دیکھیں۔</li>
        <li><em>Settings → Library Path</em> میں 20+ GB خالی جگہ والا فولڈر منتخب کریں۔</li>
        <li>اندرونی ڈاؤن لوڈر سے مطلوبہ اقسام (تفسیر، حدیث، فقہ) ڈاؤن لوڈ کریں۔</li>
      </ol>

      <h3>موبائل متبادل</h3>
      <p>
        iOS اور Android پر <em>Shamela Mobile</em> یا <em>Maktaba Shamila</em> ایپس دستیاب ہیں،
        جو وہی <code>.bok</code> / <code>.epub</code> فارمیٹ پڑھتی ہیں۔
      </p>

      <h2>3. مؤثر جستجو کی تکنیکس</h2>
      <ul>
        <li><strong>مادّہ کی جستجو</strong> — <code>ذكر</code> کی جستجو <code>الذاكرين</code> اور <code>مذكور</code> جیسے مشتقات کو بھی شامل کرے گی۔</li>
        <li><strong>جملے کی جستجو</strong> — قوٹس میں لکھیں: <code>"إنما الأعمال بالنيات"</code>۔</li>
        <li><strong>کتاب فلٹر</strong> — صرف صحیح البخاری یا مسند احمد میں جستجو محدود کر لیں۔</li>
        <li><strong>حرکات</strong> — بغیر اعراب کے تلاش کریں؛ شاملہ خودکار طور پر مطابقت کرتی ہے۔</li>
        <li><strong>Boolean</strong> — advanced search میں <code>AND</code> / <code>OR</code> / <code>NOT</code> استعمال کریں۔</li>
      </ul>

      <h2>4. شاملہ + AI (Al-Ulama Easy Editor) کا ملاپ</h2>
      <p>
        شاملہ متن نکالنے میں بے مثال ہے، مگر خلاصہ، اردو ترجمہ، یا متعدد سنن سے تصدیق نہیں
        کر سکتی۔ یہاں قرآن و حدیث پر مبنی AI اسسٹنٹ کام آتا ہے:
      </p>
      <ol>
        <li>شاملہ سے مطلوبہ عربی اقتباس کاپی کریں۔</li>
        <li>اسے <Link to="/research">Easy Editor کے Research موڈ</Link> میں پیسٹ کریں — AI حوالہ جات کے ساتھ تصدیق شدہ جواب، اردو و انگریزی ترجمہ فراہم کرے گا۔</li>
        <li>پرنٹ شدہ صفحات کی تصاویر کے لیے <Link to="/ocr">OCR</Link> استعمال کریں۔</li>
        <li>حفظ کے لیے قدرتی عربی آواز میں سنیں: <Link to="/speak">Speak</Link>۔</li>
      </ol>

      <h2>5. حوالہ کی تصدیق — مدرسہ کا محفوظ طریقہ</h2>
      <ol>
        <li>شاملہ میں اقتباس تلاش کریں → کتاب، جلد اور صفحہ نوٹ کریں۔</li>
        <li>Easy Editor کے Research موڈ سے الفاظ اور درجہ (صحیح، حسن، ضعیف) کی تصدیق کریں۔</li>
        <li>مطبوعہ ایڈیشن (دار السلام، دار المنہاج) سے آخری تصدیق کریں۔</li>
      </ol>

      <h2>6. عام سوالات</h2>
      <h3>کیا مکتبہ شاملہ مفت ہے؟</h3>
      <p>جی ہاں — ڈیسک ٹاپ ایپ اور مکمل لائبریری مفت ہے۔ Easy Editor فری‑میم ہے، Pro ٹیئر بھی موجود ہے۔</p>
      <h3>کیا اس میں اردو یا انگریزی کتب ہیں؟</h3>
      <p>نہیں — شاملہ صرف عربی ہے۔ اردو/انگریزی کے لیے Easy Editor کا Translate اور Research استعمال کریں۔</p>
      <h3>مکمل لائبریری کا سائز؟</h3>
      <p>تقریباً 20–25 GB؛ صرف مطلوبہ اقسام بھی ڈاؤن لوڈ کی جا سکتی ہیں۔</p>

      <p className="mt-8">
        شروع کریں: <Link to="/signup">مفت اکاؤنٹ بنائیں</Link> اور اپنا پہلا شاملہ اقتباس
        Research میں پیسٹ کریں۔
      </p>
    </>
  );
}

function ArabicBody() {
  return (
    <>
      <p>
        <strong>المكتبة الشاملة</strong> هي أكبر مكتبة رقمية مجانية للتراث الإسلامي العربي —
        أكثر من 7,000 كتاب في التفسير والحديث والفقه والعقيدة والسيرة وعلوم اللغة. يستعرض هذا
        الدليل تثبيت الشاملة، وأفضل طرق البحث فيها، ودمجها مع أدوات الذكاء الاصطناعي مثل
        Al-Ulama Easy Editor للحصول على بحث موثّق بالمراجع.
      </p>

      <h2>1. ما هي المكتبة الشاملة؟</h2>
      <p>
        الشاملة تُفهرس النصوص العربية كاملةً وتتيح البحث فيها بمرشحات المذهب والعصر والموضوع.
        وهي المرجع الرقمي الأول لطلبة العلم قبل الرجوع إلى الطبعات المطبوعة.
      </p>

      <h2>2. التثبيت على Windows / macOS / Linux</h2>
      <ol>
        <li>نزّل أحدث إصدار من <a href="https://shamela.ws" rel="noopener">shamela.ws</a>.</li>
        <li>على macOS و Linux استخدم <a href="https://www.winehq.org" rel="noopener">Wine</a> أو موقع <a href="https://waqfeya.net" rel="noopener">Waqfeya</a>.</li>
        <li>من <em>الإعدادات → مسار المكتبة</em> اختر مجلدًا فيه 20+ GB.</li>
        <li>استخدم مُنزّل الكتب الداخلي لتنزيل الأقسام المطلوبة (تفسير، حديث، فقه).</li>
      </ol>

      <h3>على الهاتف</h3>
      <p>تطبيقات <em>Shamela Mobile</em> على iOS و Android تقرأ الصيغة نفسها (<code>.bok</code> / <code>.epub</code>).</p>

      <h2>3. تقنيات بحث فعّالة</h2>
      <ul>
        <li><strong>البحث بالجذر</strong> — البحث عن <code>ذكر</code> يطابق <code>الذاكرين</code> و <code>مذكور</code>.</li>
        <li><strong>البحث بالعبارة</strong> — ضعها بين علامتَي اقتباس: <code>"إنما الأعمال بالنيات"</code>.</li>
        <li><strong>حصر الكتاب</strong> — اقصر البحث على صحيح البخاري أو مسند أحمد.</li>
        <li><strong>التشكيل</strong> — البحث لا يتأثر بالحركات افتراضيًا.</li>
        <li><strong>البحث المنطقي</strong> — يدعم <code>AND</code> و <code>OR</code> و <code>NOT</code>.</li>
      </ul>

      <h2>4. الشاملة مع الذكاء الاصطناعي (Al-Ulama Easy Editor)</h2>
      <p>
        الشاملة ممتازة في استخراج النصوص، لكنها لا تُلخّص ولا تُترجم إلى الأردية ولا تُوثّق
        الحديث في السنن المتعدّدة. هنا يأتي دور مساعد الأبحاث المؤسّس على القرآن والسنة:
      </p>
      <ol>
        <li>ابحث في الشاملة عن النص → انسخ الاقتباس العربي.</li>
        <li>الصقه في <Link to="/research">وضع البحث في Easy Editor</Link> ليُعيد لك إجابة موثّقة بالمراجع مع ترجمات أردية وإنجليزية.</li>
        <li>لصور صفحات الشاملة استخدم <Link to="/ocr">OCR</Link> لاستخراج النص.</li>
        <li>للحفظ، استمع للنص بصوت عربي طبيعي عبر <Link to="/speak">Speak</Link>.</li>
      </ol>

      <h2>5. التحقّق من المراجع — سير عمل آمن</h2>
      <ol>
        <li>ابحث في الشاملة → دوّن الكتاب والمجلّد والصفحة.</li>
        <li>شغّل وضع البحث في Easy Editor للتأكّد من اللفظ والدرجة (صحيح/حسن/ضعيف).</li>
        <li>راجع طبعة مطبوعة (دار السلام، دار المنهاج) قبل النشر.</li>
      </ol>

      <h2>6. أسئلة شائعة</h2>
      <h3>هل المكتبة الشاملة مجانية؟</h3>
      <p>نعم، مجانية بالكامل. Easy Editor مجاني مع خطة Pro اختيارية.</p>
      <h3>هل تحتوي على كتب أردية أو إنجليزية؟</h3>
      <p>لا — عربية فقط. للترجمة استخدم أدوات Easy Editor.</p>
      <h3>ما حجم المكتبة كاملةً؟</h3>
      <p>حوالي 20–25 GB، ويمكنك تنزيل ما تحتاجه فقط.</p>

      <p className="mt-8">
        ابدأ الآن: <Link to="/signup">أنشئ حسابًا مجانيًا</Link> والصق أوّل اقتباس من الشاملة في
        وضع البحث.
      </p>
    </>
  );
}
