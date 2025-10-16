// This script is injected into the creative's HTML inside the preview iframe.
// It should be pure JavaScript (ES5 compatible for broadest support) and self-contained.

(function() {
    'use strict';

    // --- Configuration ---
    var POLLING_INTERVAL = 100; // ms
    var POLLING_TIMEOUT = 5000; // 5 seconds
    var timeElapsed = 0;
    var bannerId = document.currentScript.getAttribute('data-banner-id');

    var globalTimeline = null;
    var isPlaying = false;
    var canControl = false;
    var foundGsap = false;
    
    function findGsap() {
        if (window.gsap && typeof window.gsap.exportRoot === 'function') {
            return window.gsap;
        }
        if (window.TimelineLite && typeof window.TimelineLite.exportRoot === 'function') {
            return window.TimelineLite;
        }
        if (window.TweenLite) {
            // Older GSAP might not have exportRoot, but we can try to control global timeline
            return window.TweenLite;
        }
        return null;
    }

    function initialize() {
        var gsap = findGsap();
        if (gsap) {
            foundGsap = true;
            // Use exportRoot if it exists, otherwise we can't safely control multiple timelines
            if (typeof gsap.exportRoot === 'function') {
                try {
                    globalTimeline = gsap.exportRoot();
                    isPlaying = !globalTimeline.paused();
                    canControl = true;
                } catch(e) {
                    console.warn('[Studio Controller] Error exporting GSAP root timeline:', e);
                    canControl = false;
                }
            } else {
                 console.warn('[Studio Controller] GSAP found, but exportRoot() is not available. Cannot guarantee full control.');
                 canControl = false;
            }
        } else {
            canControl = false;
        }

        // Send ready message to parent
        try {
            parent.postMessage({
                bannerId: bannerId,
                status: 'ready',
                isPlaying: isPlaying,
                canControl: canControl
            }, '*');
        } catch (e) {
            // This can happen if the iframe is cross-origin and the parent isn't listening yet.
        }
    }
    
    var polling = setInterval(function() {
        timeElapsed += POLLING_INTERVAL;
        var gsap = findGsap();
        if (gsap || timeElapsed >= POLLING_TIMEOUT) {
            clearInterval(polling);
            initialize();
        }
    }, POLLING_INTERVAL);


    window.addEventListener('message', function(event) {
        // Basic security check
        if (!event.data || (event.data.bannerId !== bannerId)) {
            return;
        }

        var action = event.data.action;

        if (action === 'pause' || action === 'play') {
            if (!canControl || !globalTimeline) {
                parent.postMessage({ bannerId: bannerId, status: 'playPauseFailed', error: 'GSAP timeline not found or not controllable.' }, '*');
                return;
            }
            
            if (action === 'pause') {
                globalTimeline.pause();
                isPlaying = false;
            } else if (action === 'play') {
                globalTimeline.resume();
                isPlaying = true;
            }

            parent.postMessage({ bannerId: bannerId, status: 'playPauseSuccess', isPlaying: isPlaying }, '*');
        }
    });

})();
