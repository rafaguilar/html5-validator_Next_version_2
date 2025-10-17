// This script is injected into the creative's HTML inside the preview iframe.
// It should be pure JavaScript (ES5 compatible for broadest support) and self-contained.

(function() {
    'use strict';

    // This is a reliable way to get the bannerId from the script tag that loaded this file.
    var bannerId = document.currentScript ? document.currentScript.getAttribute('data-banner-id') : null;
    
    if (!bannerId) {
        // Fallback for browsers that might not support currentScript in all contexts
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].hasAttribute('data-banner-id')) {
                bannerId = scripts[i].getAttribute('data-banner-id');
                break;
            }
        }
    }

    if (!bannerId) {
        console.error('[Studio Controller] Could not determine bannerId. Controller will not function.');
        return;
    }

    var POLLING_INTERVAL = 100; // ms
    var POLLING_TIMEOUT = 5000; // 5 seconds
    var timeElapsed = 0;

    var globalTimeline = null;
    var isPlaying = false;
    var canControl = false;

    function findGsap() {
        if (window.gsap && typeof window.gsap.exportRoot === 'function') {
            return window.gsap;
        }
        return null;
    }

    function initialize() {
        var gsap = findGsap();
        if (gsap) {
             // Use exportRoot if it exists, otherwise we can't safely control multiple timelines
            if (typeof gsap.exportRoot === 'function') {
                try {
                    // A brief delay allows animations started on page load to be captured.
                    setTimeout(function() {
                        globalTimeline = gsap.exportRoot();
                        isPlaying = !globalTimeline.paused();
                        canControl = true;
                        
                        // Send ready message to parent
                        parent.postMessage({
                            bannerId: bannerId,
                            status: 'ready',
                            isPlaying: isPlaying,
                            canControl: canControl
                        }, '*');

                    }, 100);
                } catch(e) {
                    console.warn('[Studio Controller] Error exporting GSAP root timeline:', e);
                    canControl = false;
                    parent.postMessage({ bannerId: bannerId, status: 'ready', isPlaying: false, canControl: false, error: 'Could not export GSAP timeline.' }, '*');
                }
            } else {
                 console.warn('[Studio Controller] GSAP found, but exportRoot() is not available. Control is disabled.');
                 canControl = false;
                 parent.postMessage({ bannerId: bannerId, status: 'ready', isPlaying: false, canControl: false, error: 'GSAP version does not support timeline export.' }, '*');
            }
        } else {
            // GSAP not found after timeout
            canControl = false;
            parent.postMessage({ bannerId: bannerId, status: 'ready', isPlaying: false, canControl: false, error: 'GSAP library not found in creative.' }, '*');
        }
    }
    
    // Poll for GSAP to be loaded
    var polling = setInterval(function() {
        timeElapsed += POLLING_INTERVAL;
        var gsap = findGsap();
        if (gsap || timeElapsed >= POLLING_TIMEOUT) {
            clearInterval(polling);
            initialize();
        }
    }, POLLING_INTERVAL);


    window.addEventListener('message', function(event) {
        // Basic security check - ensure message has data and is for THIS banner.
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
                // Using resume() is better than play() as it respects the playhead position
                globalTimeline.resume();
                isPlaying = true;
            }

            parent.postMessage({ bannerId: bannerId, status: 'playPauseSuccess', isPlaying: isPlaying }, '*');
        }
    });

})();
