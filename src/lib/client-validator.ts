
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';

const MAX_FILE_SIZE = 200 * 1024; // 200KB

const createIssue = (type: 'error' | 'warning' | 'info', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : (type === 'warning' ? 'client-warning' : 'client-info')),
});

const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  console.log('[TRACE] client-validator: Starting findHtmlFileInZip.');
  const allFiles = Object.keys(zip.files);
  const htmlFiles = allFiles.filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/") && !zip.files[path].dir);
  if (htmlFiles.length === 0) {
    console.log('[TRACE] client-validator: No HTML files found in zip.');
    return null;
  }
  const sorted = htmlFiles.sort((a, b) => (a.split('/').length - b.split('/').length));
  const mainHtmlPath = sorted.find(p => p.toLowerCase().endsWith('index.html')) || sorted[0];
  console.log(`[TRACE] client-validator: Determined main HTML file to be: ${mainHtmlPath}`);
  const htmlFileObject = zip.file(mainHtmlPath);
  if (htmlFileObject) {
    const content = await htmlFileObject.async("string");
    return { path: htmlFileObject.name, content };
  }
  return null;
};

const lintHtmlContent = (htmlString: string, isCreatopyProject?: boolean): ValidationIssue[] => {
  console.log('[TRACE] client-validator: Starting lintHtmlContent.');
  if (!htmlString) return [];
  const issues: ValidationIssue[] = [];
  
  // Custom check for missing space before class attribute, as htmlhint may not catch it.
  const lines = htmlString.split(/\r?\n/);
  const missingSpaceRegex = /<[^>]+?"class=/g;
  lines.forEach((line, index) => {
    let match;
    missingSpaceRegex.lastIndex = 0;
    while ((match = missingSpaceRegex.exec(line)) !== null) {
      const tagMatch = line.match(/<[^]*"class=[^>]*>/);
      const details = tagMatch
        ? `A space is required between attributes. Problem found in tag: \`${tagMatch[0]}\` on Line ${index + 1}.`
        : `A space is required before the 'class' attribute on Line ${index + 1}.`;
      issues.push(createIssue('error', 'Missing space before class attribute.', details, 'attr-missing-space-before-class'));
    }
  });

  const ruleset: RuleSet = {
    'tag-pair': true,
    'attr-value-double-quotes': true,
    'spec-char-escape': true,
  };

  const lintResults = HTMLHint.verify(htmlString, ruleset);
  console.log(`[TRACE] client-validator: HTMLHint found ${lintResults.length} issues.`);
  lintResults.forEach((msg: LintResult) => {
    let issueType: 'error' | 'warning' | 'info' = msg.type === 'error' ? 'error' : 'warning';
    let detailsText = `Line: ${msg.line}, Col: ${msg.col}, Rule: ${msg.rule.id}`;

    if (msg.rule.id === 'attr-value-double-quotes') {
      if (isCreatopyProject) {
        issueType = 'info';
        detailsText = `Line: ${msg.line}, Col: ${msg.col}. Creatopy often uses unquoted attributes. While HTML5 allows this for some attributes, double quotes are best practice for consistency and to avoid parsing issues.`;
      } else {
        issueType = 'warning';
        detailsText += `. Using single quotes or no quotes is not recommended. Double quotes are the standard and prevent parsing errors.`;
      }
    }
    issues.push(createIssue(issueType, msg.message, detailsText, msg.rule.id));
  });

  console.log(`[TRACE] client-validator: Finished lintHtmlContent. Total issues from linting: ${issues.length}`);
  return issues;
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  console.log('[TRACE] client-validator: Starting findClickTagsInHtml.');
  if (!htmlContent) return [];
  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:var|let|const)\s+(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](https?:\/\/[^"']+)["']/g;
  let match;
  while ((match = clickTagRegex.exec(htmlContent)) !== null) {
    clickTags.push({ name: match[1], url: match[2], isHttps: match[2].startsWith('https://') });
  }
  console.log(`[TRACE] client-validator: Found ${clickTags.length} clickTags.`);
  return clickTags;
};

interface CreativeAssetAnalysis {
  foundHtmlPath?: string;
  htmlContent?: string;
  issues: ValidationIssue[];
  htmlFileCount: number;
  allHtmlFilePathsInZip: string[];
  isAdobeAnimateProject: boolean;
  isCreatopyProject: boolean;
}

const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
    console.log('[TRACE] client-validator: Starting analyzeCreativeAssets.');
    const issues: ValidationIssue[] = [];
    let foundHtmlPath: string | undefined, htmlContentForAnalysis: string | undefined;
    let isAdobeAnimateProject = false, isCreatopyProject = false;

    const allowedTextExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];
    const allowedImageExtensions = ['.gif', '.jpg', '.jpeg', '.png'];
    const allowedFontExtensions = ['.eot', '.otf', '.ttf', '.woff', '.woff2'];
    const allAllowedExtensions = [...allowedTextExtensions, ...allowedImageExtensions, ...allowedFontExtensions];

    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));

    console.log('[TRACE] client-validator: Checking file extensions for all assets in zip.');
    allZipFiles.forEach(path => {
        const fileExt = (/\.([^.]+)$/.exec(path) || [''])[0].toLowerCase();
        if (!allAllowedExtensions.includes(fileExt)) {
            const message = `Unsupported file type in ZIP: '${fileExt}'`;
            const details = `File: '${path}'. This file type is not standard and may not work in all ad platforms.`;
            console.warn(`[TRACE] client-validator: ${message} - ${details}`);
            issues.push(createIssue('warning', message, details, 'unsupported-file-type'));
        } else {
            console.log(`[TRACE] client-validator: Supported file type found: '${path}'`);
        }
    });

    const allHtmlFilePathsInZip = allZipFiles.filter(path => path.toLowerCase().endsWith('.html'));
    const htmlFileCount = allHtmlFilePathsInZip.length;
    const htmlFileInfo = await findHtmlFileInZip(zip);

    if (htmlFileInfo) {
        foundHtmlPath = htmlFileInfo.path;
        htmlContentForAnalysis = htmlFileInfo.content;
    }
  
    if (htmlContentForAnalysis) {
      console.log('[TRACE] client-validator: Checking for authoring tools in HTML content.');
      if (htmlContentForAnalysis.includes("window.creatopyEmbed")) {
        isCreatopyProject = true;
        issues.push(createIssue('info', 'Creatopy project detected.', 'Specific checks for unquoted HTML attribute values have been adjusted.', 'authoring-tool-creatopy'));
      }
  
      const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
      if (doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]')) {
        isAdobeAnimateProject = true;
      }
    }
  
    console.log('[TRACE] client-validator: Finished analyzeCreativeAssets.');
    return { foundHtmlPath, htmlContent: htmlContentForAnalysis, issues, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject };
};

export const runClientSideValidation = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'preview'>> => {
    console.log(`[TRACE] client-validator: Starting runClientSideValidation for ${file.name}.`);
    const analysis = await analyzeCreativeAssets(file);
    const issues: ValidationIssue[] = [...analysis.issues];

    if (file.size > MAX_FILE_SIZE) {
        const message = `File size exceeds limit (${(MAX_FILE_SIZE / 1024).toFixed(0)}KB).`;
        const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB`;
        console.warn(`[TRACE] client-validator: ${message}`);
        issues.push(createIssue('error', message, details, 'file-size-exceeded'));
    }

    if (analysis.htmlFileCount === 0) {
        const message = 'No HTML file found in ZIP.';
        const details = 'An HTML file is required to serve as the entry point for the creative.';
        console.error(`[TRACE] client-validator: ${message}`);
        issues.push(createIssue('error', message, details, 'no-html-file'));
    } else if (analysis.htmlFileCount > 1) {
        const message = 'Multiple HTML files found in ZIP.';
        const details = `Found: ${analysis.allHtmlFilePathsInZip.join(', ')}. The validator will analyze the most likely primary file: ${analysis.foundHtmlPath}`;
        console.warn(`[TRACE] client-validator: ${message}`);
        issues.push(createIssue('warning', message, details, 'multiple-html-files'));
    }

    if (analysis.isAdobeAnimateProject && !analysis.isCreatopyProject) {
        issues.push(createIssue('info', 'Adobe Animate CC project detected.', `Specific checks for Animate structure applied.`, 'authoring-tool-animate-cc'));
    }

    const detectedClickTags = findClickTagsInHtml(analysis.htmlContent || null);
    if (detectedClickTags.length === 0 && analysis.htmlContent) {
        issues.push(createIssue('warning', 'No standard clickTag variable found.', 'A clickTag is required for ad tracking. Example: var clickTag = "https://www.example.com";', 'missing-clicktag'));
    }

    if (analysis.htmlContent) {
        issues.push(...lintHtmlContent(analysis.htmlContent, analysis.isCreatopyProject));
    }

    let actualMetaWidth: number | undefined, actualMetaHeight: number | undefined;
    if (analysis.htmlContent) {
        const metaTagMatch = analysis.htmlContent.match(/<meta\s+name=["']?ad\.size["']?\s+content=["']?width=(\d+)[,;]?\s*height=(\d+)["']?/i);
        if (metaTagMatch) {
            actualMetaWidth = parseInt(metaTagMatch[1], 10);
            actualMetaHeight = parseInt(metaTagMatch[2], 10);
            console.log(`[TRACE] client-validator: Found ad.size meta tag: ${actualMetaWidth}x${actualMetaHeight}`);
        } else {
            console.warn('[TRACE] client-validator: Missing ad.size meta tag.');
            issues.push(createIssue('error', 'Required ad.size meta tag not found.', 'The HTML file must contain a meta tag like: <meta name="ad.size" content="width=300,height=250">', 'missing-meta-size'));
        }
    }

    const adDimensions = { width: actualMetaWidth || 300, height: actualMetaHeight || 250, actual: actualMetaWidth ? { width: actualMetaWidth, height: actualMetaHeight } : undefined };
    const hasErrors = issues.some(i => i.type === 'error');
    const hasWarnings = issues.some(i => i.type === 'warning');
    let status: ValidationResult['status'] = 'success';
    if (hasErrors) {
        status = 'error';
    } else if (hasWarnings) {
        status = 'warning';
    }
    console.log(`[TRACE] client-validator: Finished runClientSideValidation. Final status: ${status}. Total issues: ${issues.length}.`);

    return {
        status,
        issues,
        adDimensions,
        fileStructureOk: !!analysis.foundHtmlPath,
        detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
        maxFileSize: MAX_FILE_SIZE,
        hasCorrectTopLevelClickTag: detectedClickTags.some(t => t.name === "clickTag" && t.isHttps)
    };
};
