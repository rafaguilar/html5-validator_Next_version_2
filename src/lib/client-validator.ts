
import JSZip from 'jszip';
import { HTMLHint, type LintResult, type RuleSet } from 'htmlhint';
import type { ValidationResult, ValidationIssue, ClickTagInfo } from '@/types';

// New tiered file size limits
const SIZE_LIMIT_ERROR = 300 * 1024; // 300KB
const SIZE_LIMIT_WARNING_HIGH = 200 * 1024; // 200KB
const SIZE_LIMIT_WARNING_LOW = 150 * 1024; // 150KB

const createIssue = (type: 'error' | 'warning' | 'info', message: string, details?: string, rule?: string): ValidationIssue => ({
  id: `issue-client-${Math.random().toString(36).substr(2, 9)}`,
  type,
  message,
  details,
  rule: rule || (type === 'error' ? 'client-error' : (type === 'warning' ? 'client-warning' : 'client-info')),
});

const findHtmlFileInZip = async (zip: JSZip): Promise<{ path: string, content: string } | null> => {
  const allFiles = Object.keys(zip.files);
  const htmlFiles = allFiles.filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/") && !zip.files[path].dir);
  if (htmlFiles.length === 0) {
    return null;
  }
  const sorted = htmlFiles.sort((a, b) => (a.split('/').length - b.split('/').length));
  const mainHtmlPath = sorted.find(p => p.toLowerCase().endsWith('index.html')) || sorted[0];
  const htmlFileObject = zip.file(mainHtmlPath);
  if (htmlFileObject) {
    const content = await htmlFileObject.async("string");
    return { path: htmlFileObject.name, content };
  }
  return null;
};

const lintHtmlContent = (htmlString: string, isCreatopyProject?: boolean): ValidationIssue[] => {
  if (!htmlString) return [];
  const issues: ValidationIssue[] = [];
  
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

  return issues;
};

const findClickTagsInHtml = (htmlContent: string | null): ClickTagInfo[] => {
  if (!htmlContent) return [];
  const clickTags: ClickTagInfo[] = [];
  const clickTagRegex = /(?:var|let|const)\s+(?:window\.)?([a-zA-Z0-9_]*clickTag[a-zA-Z0-9_]*)\s*=\s*["'](https?:\/\/[^"']+)["']/g;
  let match;
  while ((match = clickTagRegex.exec(htmlContent)) !== null) {
    clickTags.push({ name: match[1], url: match[2], isHttps: match[2].startsWith('https://') });
  }
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
  zip: JSZip;
}

const analyzeCreativeAssets = async (file: File): Promise<CreativeAssetAnalysis> => {
    const issues: ValidationIssue[] = [];
    let foundHtmlPath: string | undefined, htmlContentForAnalysis: string | undefined;
    let isAdobeAnimateProject = false, isCreatopyProject = false;

    const allowedTextExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];
    const allowedImageExtensions = ['.gif', '.jpg', '.jpeg', '.png'];
    const allowedFontExtensions = ['.eot', '.otf', '.ttf', '.woff', '.woff2'];
    const allAllowedExtensions = [...allowedTextExtensions, ...allowedImageExtensions, ...allowedFontExtensions];

    const zip = await JSZip.loadAsync(file);
    const allZipFiles = Object.keys(zip.files).filter(path => !zip.files[path].dir && !path.startsWith("__MACOSX/") && !path.endsWith('.DS_Store'));

    allZipFiles.forEach(path => {
        const fileExt = (/\.([^.]+)$/.exec(path) || [''])[0].toLowerCase();
        if (!allAllowedExtensions.includes(fileExt)) {
            const message = `Unsupported file type in ZIP: '${fileExt}'`;
            const details = `File: '${path}'. This file type is not standard and may not work in all ad platforms. Only the following are supported: ${allAllowedExtensions.join(', ')}.`;
            issues.push(createIssue('warning', message, details, 'unsupported-file-type'));
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
      if (htmlContentForAnalysis.includes("window.creatopyEmbed")) {
        isCreatopyProject = true;
        issues.push(createIssue('info', 'Creatopy project detected.', 'Specific checks for unquoted HTML attribute values have been adjusted.', 'authoring-tool-creatopy'));
      }
  
      const doc = new DOMParser().parseFromString(htmlContentForAnalysis, 'text/html');
      if (doc.querySelector('meta[name="authoring-tool"][content="Adobe_Animate_CC"]')) {
        isAdobeAnimateProject = true;
      }
    }
  
    return { foundHtmlPath, htmlContent: htmlContentForAnalysis, issues, htmlFileCount, allHtmlFilePathsInZip, isAdobeAnimateProject, isCreatopyProject, zip };
};

export const runClientSideValidation = async (file: File): Promise<Omit<ValidationResult, 'id' | 'fileName' | 'fileSize' | 'preview'>> => {
    const analysis = await analyzeCreativeAssets(file);
    const issues: ValidationIssue[] = [...analysis.issues];

    // Updated file size validation logic
    if (file.size > SIZE_LIMIT_ERROR) {
      const message = `File size exceeds 300KB. This is not allowed.`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. You must reduce the file size to be under 300KB.`;
      issues.push(createIssue('error', message, details, 'file-size-error'));
    } else if (file.size > SIZE_LIMIT_WARNING_HIGH) {
      const message = `File size is large (201KB - 300KB).`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. While acceptable, this may impact loading performance. Consider optimizing assets.`;
      issues.push(createIssue('warning', message, details, 'file-size-warning-high'));
    } else if (file.size > SIZE_LIMIT_WARNING_LOW) {
      const message = `File size is approaching the limit (150KB - 200KB).`;
      const details = `Actual size: ${(file.size / 1024).toFixed(2)}KB. Consider optimizing assets to stay well under the limit.`;
      issues.push(createIssue('warning', message, details, 'file-size-warning-low'));
    }

    if (analysis.htmlFileCount === 0) {
        const message = 'No HTML file found in ZIP.';
        const details = 'An HTML file is required to serve as the entry point for the creative.';
        issues.push(createIssue('error', message, details, 'no-html-file'));
    } else if (analysis.htmlFileCount > 1) {
        const message = 'Multiple HTML files found in ZIP.';
        const details = `Found: ${analysis.allHtmlFilePathsInZip.join(', ')}. The validator will analyze the most likely primary file: ${analysis.foundHtmlPath}`;
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
        } else {
            const severity = analysis.isAdobeAnimateProject ? 'warning' : 'error';
            const details = analysis.isAdobeAnimateProject 
              ? 'Adobe Animate units often rely on canvas dimensions. While not a critical error, including this tag is best practice for platform compatibility.'
              : 'The HTML file must contain a meta tag like: <meta name="ad.size" content="width=300,height=250">';
            issues.push(createIssue(severity, 'Required ad.size meta tag not found.', details, 'missing-meta-size'));
        }
    }

    if (analysis.isAdobeAnimateProject && analysis.htmlContent) {
        const doc = new DOMParser().parseFromString(analysis.htmlContent, 'text/html');
        const canvas = doc.querySelector('canvas');
        if (canvas && canvas.width && canvas.height) {
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            const jsFiles = Object.values(analysis.zip.files).filter(f => f.name.toLowerCase().endsWith('.js') && !f.dir);
            let propertiesFound = false;

            for (const jsFile of jsFiles) {
                const jsContent = await jsFile.async('string');
                const propsMatch = jsContent.match(/lib\.properties\s*=\s*{\s*[^}]*width:\s*(\d+)\s*,\s*height:\s*(\d+)/);
                if (propsMatch) {
                    propertiesFound = true;
                    const jsWidth = parseInt(propsMatch[1], 10);
                    const jsHeight = parseInt(propsMatch[2], 10);
                    if (canvasWidth !== jsWidth || canvasHeight !== jsHeight) {
                        const message = 'Canvas and JS dimensions do not match.';
                        const details = `The HTML canvas is ${canvasWidth}x${canvasHeight}px, but the lib.properties in '${jsFile.name}' is set to ${jsWidth}x${jsHeight}px. These must be consistent.`;
                        issues.push(createIssue('warning', message, details, 'animate-dimension-mismatch'));
                    }
                    break; 
                }
            }
            if (!propertiesFound) {
                 issues.push(createIssue('info', 'Could not find lib.properties in JS files.', `Could not verify canvas dimensions against a JavaScript properties object for this Animate creative.`, 'animate-props-not-found'));
            }
        } else {
            issues.push(createIssue('warning', 'Canvas element not found or missing dimensions.', `Could not find a <canvas> element with width and height attributes in the HTML file for dimension validation.`, 'animate-canvas-not-found'));
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

    return {
        status,
        issues,
        adDimensions,
        fileStructureOk: !!analysis.foundHtmlPath,
        htmlEntryPoint: analysis.foundHtmlPath,
        htmlContent: analysis.htmlContent,
        detectedClickTags: detectedClickTags.length > 0 ? detectedClickTags : undefined,
        maxFileSize: SIZE_LIMIT_ERROR, // The max size is now 300KB
        hasCorrectTopLevelClickTag: detectedClickTags.some(t => t.name === "clickTag" && t.isHttps)
    };
};
