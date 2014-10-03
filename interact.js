/**
 * interact.js v1.0.26
 *
 * Copyright (c) 2012, 2013, 2014 Taye Adeyemi <dev@taye.me>
 * Open source under the MIT License.
 * https://raw.github.com/taye/interact.js/master/LICENSE
 */
(function () {
    'use strict';

    var document           = window.document,
        console            = window.console,
        SVGElement         = window.SVGElement         || blank,
        SVGSVGElement      = window.SVGSVGElement      || blank,
        SVGElementInstance = window.SVGElementInstance || blank,
        HTMLElement        = window.HTMLElement        || window.Element,

        PointerEvent = (window.PointerEvent || window.MSPointerEvent),
        pEventTypes,

        hypot = Math.hypot || function (x, y) { return Math.sqrt(x * x + y * y); },

        tmpXY = {},     // reduce object creation in getXY()

        interactables   = [],   // all set interactables
        dropzones       = [],   // all dropzone element interactables
        interactions    = [],

        claimedPointers = [],
        claimedElements = [],

        dynamicDrop     = false,

        // {
        //      type: {
        //          selectors: ['selector', ...],
        //          contexts : [document, ...],
        //          listeners: [[listener, useCapture], ...]
        //      }
        //  }
        delegatedEvents = {},

        defaultOptions = {
            draggable   : false,
            dragAxis    : 'xy',
            dropzone    : false,
            accept      : null,
            dropOverlap : 'pointer',
            resizable   : false,
            squareResize: false,
            resizeAxis  : 'xy',
            gesturable  : false,

            pointerMoveTolerance: 1,

            actionChecker: null,

            styleCursor: true,
            preventDefault: 'auto',

            // aww snap
            snap: {
                mode        : 'grid',
                endOnly     : false,
                actions     : ['drag'],
                range       : Infinity,
                grid        : { x: 100, y: 100 },
                gridOffset  : { x:   0, y:   0 },
                anchors     : [],
                paths       : [],

                elementOrigin: null,

                arrayTypes  : /^anchors$|^paths$|^actions$/,
                objectTypes : /^grid$|^gridOffset$|^elementOrigin$/,
                stringTypes : /^mode$/,
                numberTypes : /^range$/,
                boolTypes   :  /^endOnly$/
            },
            snapEnabled: false,

            restrict: {
                drag: null,
                resize: null,
                gesture: null,
                endOnly: false
            },
            restrictEnabled: false,

            autoScroll: {
                container   : window,  // the item that is scrolled (Window or HTMLElement)
                margin      : 60,
                speed       : 300,      // the scroll speed in pixels per second

                numberTypes : /^margin$|^speed$/
            },
            autoScrollEnabled: false,

            inertia: {
                resistance       : 10,    // the lambda in exponential decay
                minSpeed         : 100,   // target speed must be above this for inertia to start
                endSpeed         : 10,    // the speed at which inertia is slow enough to stop
                zeroResumeDelta  : false, // if an action is resumed after launch, set dx/dy to 0
                smoothEndDuration: 300,   // animate to snap/restrict endOnly if there's no inertia
                actions          : ['drag', 'resize'],  // allow inertia on these actions. gesture might not work

                numberTypes: /^resistance$|^minSpeed$|^endSpeed$|^smoothEndDuration$/,
                arrayTypes : /^actions$/,
                boolTypes  : /^zeroResumeDelta$/
            },
            inertiaEnabled: false,

            origin      : { x: 0, y: 0 },
            deltaSource : 'page',

            context     : document        // the Node on which querySelector will be called
        },

        // Things related to autoScroll
        autoScroll = {
            target: null,
            i: null,    // the handle returned by window.setInterval
            x: 0, y: 0, // Direction each pulse is to scroll in

            // scroll the window by the values in scroll.x/y
            scroll: function () {
                var options = autoScroll.target.options.autoScroll,
                    container = options.container,
                    now = new Date().getTime(),
                    // change in time in seconds
                    dt = (now - autoScroll.prevTime) / 1000,
                    // displacement
                    s = options.speed * dt;

                if (s >= 1) {
                    if (container instanceof window.Window) {
                        container.scrollBy(autoScroll.x * s, autoScroll.y * s);
                    }
                    else if (container) {
                        container.scrollLeft += autoScroll.x * s;
                        container.scrollTop  += autoScroll.y * s;
                    }

                    autoScroll.prevTime = now;
                }

                if (autoScroll.isScrolling) {
                    cancelFrame(autoScroll.i);
                    autoScroll.i = reqFrame(autoScroll.scroll);
                }
            },

            edgeMove: function (event) {
                var target = interactions[0] && interactions[0].target;

                if (target && target.options.autoScrollEnabled && (this.dragging || this.resizing)) {
                    var top,
                        right,
                        bottom,
                        left,
                        options = target.options.autoScroll;

                    if (options.container instanceof window.Window) {
                        left   = event.clientX < autoScroll.margin;
                        top    = event.clientY < autoScroll.margin;
                        right  = event.clientX > options.container.innerWidth  - autoScroll.margin;
                        bottom = event.clientY > options.container.innerHeight - autoScroll.margin;
                    }
                    else {
                        var rect = getElementRect(options.container);

                        left   = event.clientX < rect.left   + autoScroll.margin;
                        top    = event.clientY < rect.top    + autoScroll.margin;
                        right  = event.clientX > rect.right  - autoScroll.margin;
                        bottom = event.clientY > rect.bottom - autoScroll.margin;
                    }

                    autoScroll.x = (right ? 1: left? -1: 0);
                    autoScroll.y = (bottom? 1:  top? -1: 0);

                    if (!autoScroll.isScrolling) {
                        // set the autoScroll properties to those of the target
                        autoScroll.margin = options.margin;
                        autoScroll.speed  = options.speed;

                        autoScroll.start(target);
                    }
                }
            },

            isScrolling: false,
            prevTime: 0,

            start: function (target) {
                autoScroll.isScrolling = true;
                cancelFrame(autoScroll.i);

                autoScroll.target = target;
                autoScroll.prevTime = new Date().getTime();
                autoScroll.i = reqFrame(autoScroll.scroll);
            },

            stop: function () {
                autoScroll.isScrolling = false;
                cancelFrame(autoScroll.i);
            }
        },

        // Does the browser support touch input?
        supportsTouch = (('ontouchstart' in window) || window.DocumentTouch && document instanceof window.DocumentTouch),

        // Does the browser support PointerEvents
        supportsPointerEvent = !!PointerEvent,

        // Less Precision with touch input
        margin = supportsTouch || supportsPointerEvent? 20: 10,

        actionCursors = {
            drag    : 'move',
            resizex : 'e-resize',
            resizey : 's-resize',
            resizexy: 'se-resize',
            gesture : ''
        },

        actionIsEnabled = {
            drag   : true,
            resize : true,
            gesture: true
        },

        // because Webkit and Opera still use 'mousewheel' event type
        wheelEvent = 'onmousewheel' in document? 'mousewheel': 'wheel',

        eventTypes = [
            'dragstart',
            'dragmove',
            'draginertiastart',
            'dragend',
            'dragenter',
            'dragleave',
            'dropactivate',
            'dropdeactivate',
            'dropmove',
            'drop',
            'resizestart',
            'resizemove',
            'resizeinertiastart',
            'resizeend',
            'gesturestart',
            'gesturemove',
            'gestureinertiastart',
            'gestureend',

            'tap',
            'doubletap'
        ],

        globalEvents = {},

        fireStates = {
            directBind: 0,
            onevent   : 1,
            globalBind: 2
        },

        // Opera Mobile must be handled differently
        isOperaMobile = navigator.appName == 'Opera' &&
            supportsTouch &&
            navigator.userAgent.match('Presto'),

        // prefix matchesSelector
        prefixedMatchesSelector = 'matchesSelector' in Element.prototype?
                'matchesSelector': 'webkitMatchesSelector' in Element.prototype?
                    'webkitMatchesSelector': 'mozMatchesSelector' in Element.prototype?
                        'mozMatchesSelector': 'oMatchesSelector' in Element.prototype?
                            'oMatchesSelector': 'msMatchesSelector',

        // will be polyfill function if browser is IE8
        ie8MatchesSelector,

        // native requestAnimationFrame or polyfill
        reqFrame = window.requestAnimationFrame,
        cancelFrame = window.cancelAnimationFrame,

        // used for adding event listeners to window and document
        windowTarget       = { _element: window       , events  : {} },
        docTarget          = { _element: document     , events  : {} },
        parentWindowTarget = { _element: window.parent, events  : {} },
        parentDocTarget    = { _element: null         , events  : {} },

        // Events wrapper
        events = (function () {
            var useAttachEvent = ('attachEvent' in window) && !('addEventListener' in window),
                addEvent       = useAttachEvent?  'attachEvent': 'addEventListener',
                removeEvent    = useAttachEvent?  'detachEvent': 'removeEventListener',
                on             = useAttachEvent? 'on': '',

                elements          = [],
                targets           = [],
                attachedListeners = [];

            function add (element, type, listener, useCapture) {
                var elementIndex = indexOf(elements, element),
                    target = targets[elementIndex];

                if (!target) {
                    target = {
                        events: {},
                        typeCount: 0
                    };

                    elementIndex = elements.push(element) - 1;
                    targets.push(target);

                    attachedListeners.push((useAttachEvent ? {
                            supplied: [],
                            wrapped : [],
                            useCount: []
                        } : null));
                }

                if (!target.events[type]) {
                    target.events[type] = [];
                    target.typeCount++;
                }

                if (!contains(target.events[type], listener)) {
                    var ret;

                    if (useAttachEvent) {
                        var listeners = attachedListeners[elementIndex],
                            listenerIndex = indexOf(listeners.supplied, listener);

                        var wrapped = listeners.wrapped[listenerIndex] || function (event) {
                            if (!event.immediatePropagationStopped) {
                                event.target = event.srcElement;
                                event.currentTarget = element;

                                event.preventDefault = event.preventDefault || preventDef;
                                event.stopPropagation = event.stopPropagation || stopProp;
                                event.stopImmediatePropagation = event.stopImmediatePropagation || stopImmProp;

                                if (/mouse|click/.test(event.type)) {
                                    event.pageX = event.clientX + document.documentElement.scrollLeft;
                                    event.pageY = event.clientY + document.documentElement.scrollTop;
                                }

                                listener(event);
                            }
                        };

                        ret = element[addEvent](on + type, wrapped, Boolean(useCapture));

                        if (listenerIndex === -1) {
                            listeners.supplied.push(listener);
                            listeners.wrapped.push(wrapped);
                            listeners.useCount.push(1);
                        }
                        else {
                            listeners.useCount[listenerIndex]++;
                        }
                    }
                    else {
                        ret = element[addEvent](type, listener, useCapture || false);
                    }
                    target.events[type].push(listener);

                    return ret;
                }
            }

            function remove (element, type, listener, useCapture) {
                var i,
                    elementIndex = indexOf(elements, element),
                    target = targets[elementIndex],
                    listeners,
                    listenerIndex,
                    wrapped = listener;

                if (!target || !target.events) {
                    return;
                }

                if (useAttachEvent) {
                    listeners = attachedListeners[elementIndex];
                    listenerIndex = indexOf(listeners.supplied, listener);
                    wrapped = listeners.wrapped[listenerIndex];
                }

                if (type === 'all') {
                    for (type in target.events) {
                        if (target.events.hasOwnProperty(type)) {
                            remove(element, type, 'all');
                        }
                    }
                    return;
                }

                if (target.events[type]) {
                    var len = target.events[type].length;

                    if (listener === 'all') {
                        for (i = 0; i < len; i++) {
                            remove(element, type, target.events[type][i], Boolean(useCapture));
                        }
                    } else {
                        for (i = 0; i < len; i++) {
                            if (target.events[type][i] === listener) {
                                element[removeEvent](on + type, wrapped, useCapture || false);
                                target.events[type].splice(i, 1);

                                if (useAttachEvent && listeners) {
                                    listeners.useCount[listenerIndex]--;
                                    if (listeners.useCount[listenerIndex] === 0) {
                                        listeners.supplied.splice(listenerIndex, 1);
                                        listeners.wrapped.splice(listenerIndex, 1);
                                        listeners.useCount.splice(listenerIndex, 1);
                                    }
                                }

                                break;
                            }
                        }
                    }

                    if (target.events[type] && target.events[type].length === 0) {
                        target.events[type] = null;
                        target.typeCount--;
                    }
                }

                if (!target.typeCount) {
                    targets.splice(elementIndex);
                    elements.splice(elementIndex);
                    attachedListeners.splice(elementIndex);
                }
            }

            function preventDef () {
                this.returnValue = false;
            }

            function stopProp () {
                this.cancelBubble = true;
            }

            function stopImmProp () {
                this.cancelBubble = true;
                this.immediatePropagationStopped = true;
            }

            return {
                add: function (target, type, listener, useCapture) {
                    add(target._element, type, listener, useCapture);
                },
                remove: function (target, type, listener, useCapture) {
                    remove(target._element, type, listener, useCapture);
                },
                addToElement: add,
                removeFromElement: remove,
                useAttachEvent: useAttachEvent,

                indexOf: indexOf
            };
        }());

    function blank () {}

    function isElement (o) {
        return !!o && (typeof o === 'object') && (
            /object|function/.test(typeof Element)
                ? o instanceof Element //DOM2
                : o.nodeType === 1 && typeof o.nodeName === "string");
    }
    function isObject   (thing) { return thing instanceof Object; }
    function isArray    (thing) { return thing instanceof Array ; }
    function isFunction (thing) { return typeof thing === 'function'; }
    function isNumber   (thing) { return typeof thing === 'number'  ; }
    function isBool     (thing) { return typeof thing === 'boolean' ; }
    function isString   (thing) { return typeof thing === 'string'  ; }

    function extend (dest, source) {
        for (var prop in source) {
            dest[prop] = source[prop];
        }
        return dest;
    }

    function cloneEvent (event) {
        var clone = extend({}, event),
            i;

        clone.constructor = event.constructor;

        if (event.touches) {
            clone.touches = [];
            clone.changedTouches = [];

            for (i = 0; i < event.touches.length; i++) {
                clone.touches.push(extend({}, event.touches[i]));
            }
            for (i = 0; i < event.touches.length; i++) {
                clone.changedTouches.push(extend({}, event.changedTouches[i]));
            }
        }

        return clone;
    }

    function setEventXY (targetObj, source, interaction) {
        getPageXY(source, tmpXY, interaction);
        targetObj.pageX = tmpXY.x;
        targetObj.pageY = tmpXY.y;

        getClientXY(source, tmpXY, interaction);
        targetObj.clientX = tmpXY.x;
        targetObj.clientY = tmpXY.y;

        targetObj.timeStamp = new Date().getTime();
    }

    function setEventDeltas (targetObj, prev, cur) {
        targetObj.pageX     = cur.pageX      - prev.pageX;
        targetObj.pageY     = cur.pageY      - prev.pageY;
        targetObj.clientX   = cur.clientX    - prev.clientX;
        targetObj.clientY   = cur.clientY    - prev.clientY;
        targetObj.timeStamp = new Date().getTime() - prev.timeStamp;

        // set pointer velocity
        var dt = Math.max(targetObj.timeStamp / 1000, 0.001);
        targetObj.pageSpeed   = hypot(targetObj.pageX, targetObj.pageY) / dt;
        targetObj.pageVX      = targetObj.pageX / dt;
        targetObj.pageVY      = targetObj.pageY / dt;

        targetObj.clientSpeed = hypot(targetObj.clientX, targetObj.pageY) / dt;
        targetObj.clientVX    = targetObj.clientX / dt;
        targetObj.clientVY    = targetObj.clientY / dt;
    }

    // Get specified X/Y coords for mouse or event.touches[0]
    function getXY (type, event, xy) {
        var x,
            y;

        xy = xy || {};
        type = type || 'page';

        if (/touch/.test(event.type) && event.changedTouches) {
            var touch = event.changedTouches[0];

            x = touch[type + 'X'];
            y = touch[type + 'Y'];
        }
        else {
            x = event[type + 'X'];
            y = event[type + 'Y'];
        }

        xy.x = x;
        xy.y = y;

        return xy;
    }

    function getPageXY (event, page, interaction) {
        page = page || {};

        if (event instanceof InteractEvent) {
            if (/inertiastart/.test(event.type)) {
                getPageXY(interaction.inertiaStatus.pointerUp, page);

                page.x += interaction.inertiaStatus.sx;
                page.y += interaction.inertiaStatus.sy;
            }
            else {
                page.x = event.pageX;
                page.y = event.pageY;
            }
        }
        // Opera Mobile handles the viewport and scrolling oddly
        else if (isOperaMobile) {
            getXY('screen', event, page);

            page.x += window.scrollX;
            page.y += window.scrollY;
        }
        else {
            getXY('page', event, page);
        }

        return page;
    }

    function getClientXY (event, client, interaction) {
        client = client || {};

        if (event instanceof InteractEvent) {
            if (/inertiastart/.test(event.type)) {
                getClientXY(interaction.inertiaStatus.pointerUp, client);

                client.x += interaction.inertiaStatus.sx;
                client.y += interaction.inertiaStatus.sy;
            }
            else {
                client.x = event.clientX;
                client.y = event.clientY;
            }
        }
        else {
            // Opera Mobile handles the viewport and scrolling oddly
            getXY(isOperaMobile? 'screen': 'client', event, client);
        }

        return client;
    }

    function getScrollXY () {
        return {
            x: window.scrollX || document.documentElement.scrollLeft,
            y: window.scrollY || document.documentElement.scrollTop
        };
    }

    function getPointerId (pointer) {
        return isNumber(pointer.pointerId)? pointer.pointerId : pointer.identifier;
    }

    function getElementRect (element) {
        var scroll = /ipad|iphone|ipod/i.test(navigator.userAgent)
                ? { x: 0, y: 0 }
                : getScrollXY(),
            clientRect = (element instanceof SVGElement)?
                element.getBoundingClientRect():
                element.getClientRects()[0];

        return clientRect && {
            left  : clientRect.left   + scroll.x,
            right : clientRect.right  + scroll.x,
            top   : clientRect.top    + scroll.y,
            bottom: clientRect.bottom + scroll.y,
            width : clientRect.width || clientRect.right - clientRect.left,
            height: clientRect.heigh || clientRect.bottom - clientRect.top
        };
    }

    function getTouchPair (event) {
        var touches = [];

        // array of touches is supplied
        if (isArray(event)) {
            touches[0] = event[0];
            touches[1] = event[1];
        }
        // an event
        else {
            if (event.type === 'touchend') {
                if (event.touches.length === 1) {
                    touches[0] = event.touches[0];
                    touches[1] = event.changedTouches[0];
                }
                else if (event.touches.length === 0) {
                    touches[0] = event.changedTouches[0];
                    touches[1] = event.changedTouches[1];
                }
            }
            else {
                touches[0] = event.touches[0];
                touches[1] = event.touches[1];
            }
        }

        return touches;
    }

    function touchAverage (event) {
        var touches = getTouchPair(event);

        return {
            pageX: (touches[0].pageX + touches[1].pageX) / 2,
            pageY: (touches[0].pageY + touches[1].pageY) / 2,
            clientX: (touches[0].clientX + touches[1].clientX) / 2,
            clientY: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function touchBBox (event) {
        if (!event.length && !(event.touches && event.touches.length > 1)) {
            return;
        }

        var touches = getTouchPair(event),
            minX = Math.min(touches[0].pageX, touches[1].pageX),
            minY = Math.min(touches[0].pageY, touches[1].pageY),
            maxX = Math.max(touches[0].pageX, touches[1].pageX),
            maxY = Math.max(touches[0].pageY, touches[1].pageY);

        return {
            x: minX,
            y: minY,
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    function touchDistance (event, deltaSource) {
        deltaSource = deltaSource || defaultOptions.deltaSource;

        var sourceX = deltaSource + 'X',
            sourceY = deltaSource + 'Y',
            touches = getTouchPair(event);


        var dx = touches[0][sourceX] - touches[1][sourceX],
            dy = touches[0][sourceY] - touches[1][sourceY];

        return hypot(dx, dy);
    }

    function touchAngle (event, prevAngle, deltaSource) {
        deltaSource = deltaSource || defaultOptions.deltaSource;

        var sourceX = deltaSource + 'X',
            sourceY = deltaSource + 'Y',
            touches = getTouchPair(event),
            dx = touches[0][sourceX] - touches[1][sourceX],
            dy = touches[0][sourceY] - touches[1][sourceY],
            angle = 180 * Math.atan(dy / dx) / Math.PI;

        if (isNumber(prevAngle)) {
            var dr = angle - prevAngle,
                drClamped = dr % 360;

            if (drClamped > 315) {
                angle -= 360 + (angle / 360)|0 * 360;
            }
            else if (drClamped > 135) {
                angle -= 180 + (angle / 360)|0 * 360;
            }
            else if (drClamped < -315) {
                angle += 360 + (angle / 360)|0 * 360;
            }
            else if (drClamped < -135) {
                angle += 180 + (angle / 360)|0 * 360;
            }
        }

        return  angle;
    }

    function getOriginXY (interactable, element) {
        var origin = interactable
                ? interactable.options.origin
                : defaultOptions.origin;

        element = element || interactable._element;

        if (origin === 'parent') {
            origin = element.parentNode;
        }
        else if (origin === 'self') {
            origin = element;
        }

        if (isElement(origin))  {
            origin = getElementRect(origin);

            origin.x = origin.left;
            origin.y = origin.top;
        }
        else if (isFunction(origin)) {
            origin = origin(interactable && element);
        }

        return origin;
    }

    function _getQBezierValue(t, p1, p2, p3) {
        var iT = 1 - t;
        return iT * iT * p1 + 2 * iT * t * p2 + t * t * p3;
    }

    function getQuadraticCurvePoint(startX, startY, cpX, cpY, endX, endY, position) {
        return {
            x:  _getQBezierValue(position, startX, cpX, endX),
            y:  _getQBezierValue(position, startY, cpY, endY)
        };
    }

    // http://gizma.com/easing/
    function easeOutQuad (t, b, c, d) {
        t /= d;
        return -c * t*(t-2) + b;
    }

    function nodeContains (parent, child) {
        while ((child = child.parentNode)) {

            if (child === parent) {
                return true;
            }
        }

        return false;
    }

    function inContext (interactable, element) {
        return interactable._context === document
                || nodeContains(interactable._context, element);
    }

    function testIgnore (interactable, element) {
        var ignoreFrom = interactable.options.ignoreFrom;

        if (!ignoreFrom
            // limit test to the interactable's element and its children
            || !isElement(element) || element === interactable._element.parentNode) {
            return false;
        }

        if (isString(ignoreFrom)) {
            return matchesSelector(element, ignoreFrom) || testIgnore(interactable, element.parentNode);
        }
        else if (isElement(ignoreFrom)) {
            return element === ignoreFrom || nodeContains(ignoreFrom, element);
        }

        return false;
    }

    function testAllow (interactable, element) {
        var allowFrom = interactable.options.allowFrom;

        if (!allowFrom) { return true; }

        // limit test to the interactable's element and its children
        if (!isElement(element) || element === interactable._element.parentNode) {
            return false;
        }

        if (isString(allowFrom)) {
            return matchesSelector(element, allowFrom) || testAllow(interactable, element.parentNode);
        }
        else if (isElement(allowFrom)) {
            return element === allowFrom || nodeContains(allowFrom, element);
        }

        return false;
    }

    function checkAxis (axis, interactable) {
        if (!interactable) { return false; }

        var thisAxis = interactable.options.dragAxis;

        return (axis === 'xy' || thisAxis === 'xy' || thisAxis === axis);
    }

    function checkSnap (interactable, action) {
        var options = interactable.options;

        if (/^resize/.test(action)) {
            action = 'resize';
        }

        return (options.snapEnabled && contains(options.snap.actions, action));
    }

    function checkRestrict (interactable, action) {
        var options = interactable.options;

        if (/^resize/.test(action)) {
            action = 'resize';
        }

        return options.restrictEnabled && options.restrict[action];
    }

    // Test for the element that's "above" all other qualifiers
    function indexOfDeepestElement (elements) {
        var dropzone,
            deepestZone = elements[0],
            index = deepestZone? 0: -1,
            parent,
            deepestZoneParents = [],
            dropzoneParents = [],
            child,
            i,
            n;

        for (i = 1; i < elements.length; i++) {
            dropzone = elements[i];

            // an element might belong to multiple selector dropzones
            if (!dropzone || dropzone === deepestZone) {
                continue;
            }

            if (!deepestZone) {
                deepestZone = dropzone;
                index = i;
                continue;
            }

            // check if the deepest or current are document.documentElement or document.rootElement
            // - if the current dropzone is, do nothing and continue
            if (dropzone.parentNode === document) {
                continue;
            }
            // - if deepest is, update with the current dropzone and continue to next
            else if (deepestZone.parentNode === document) {
                deepestZone = dropzone;
                index = i;
                continue;
            }

            if (!deepestZoneParents.length) {
                parent = deepestZone;
                while (parent.parentNode && parent.parentNode !== document) {
                    deepestZoneParents.unshift(parent);
                    parent = parent.parentNode;
                }
            }

            // if this element is an svg element and the current deepest is
            // an HTMLElement
            if (deepestZone instanceof HTMLElement
                && dropzone instanceof SVGElement
                && !(dropzone instanceof SVGSVGElement)) {

                if (dropzone === deepestZone.parentNode) {
                    continue;
                }

                parent = dropzone.ownerSVGElement;
            }
            else {
                parent = dropzone;
            }

            dropzoneParents = [];

            while (parent.parentNode !== document) {
                dropzoneParents.unshift(parent);
                parent = parent.parentNode;
            }

            n = 0;

            // get (position of last common ancestor) + 1
            while (dropzoneParents[n] && dropzoneParents[n] === deepestZoneParents[n]) {
                n++;
            }

            var parents = [
                dropzoneParents[n - 1],
                dropzoneParents[n],
                deepestZoneParents[n]
            ];

            child = parents[0].lastChild;

            while (child) {
                if (child === parents[1]) {
                    deepestZone = dropzone;
                    index = i;
                    deepestZoneParents = [];

                    break;
                }
                else if (child === parents[2]) {
                    break;
                }

                child = child.previousSibling;
            }
        }

        return index;
    }

    function Interaction () {
        this.target          = null; // current interactable being interacted with
        this.element         = null; // the target element of the interactable
        this.dropTarget      = null; // the dropzone a drag target might be dropped into
        this.dropElement     = null; // the element at the time of checking
        this.prevDropTarget  = null; // the dropzone that was recently dragged away from
        this.prevDropElement = null; // the element at the time of checking

        this.prepared        = null; // Action that's ready to be fired on next move event

        this.matches         = [];   // all selectors that are matched by target element

        this.inertiaStatus = {
            active       : false,
            smoothEnd    : false,
            target       : null,
            targetElement: null,

            startEvent: null,
            pointerUp : {},

            xe: 0, ye: 0,
            sx: 0, sy: 0,

            t0: 0,
            vx0: 0, vys: 0,
            duration: 0,

            resumeDx: 0,
            resumeDy: 0,

            lambda_v0: 0,
            one_ve_v0: 0,
            i  : null
        };

        this.boundInertiaFrame = this.inertiaFrame.bind(this);
        this.boundSmoothEndFrame = this.smoothEndFrame.bind(this);

        this.activeDrops = {
            dropzones: [],      // the dropzones that are mentioned below
            elements : [],      // elements of dropzones that accept the target draggable
            rects    : []       // the rects of the elements mentioned above
        };

        // keep track of added pointers
        this.pointerIds   = [];
        this.pointerMoves = [];

        // Previous native pointer move event coordinates
        this.prevCoords = {
            pageX    : 0, pageY  : 0,
            clientX  : 0, clientY: 0,
            timeStamp: 0
        };
        // current native pointer move event coordinates
        this.curCoords = {
            pageX    : 0, pageY  : 0,
            clientX  : 0, clientY: 0,
            timeStamp: 0
        };

        // Starting InteractEvent pointer coordinates
        this.startCoords = {
            pageX    : 0, pageY  : 0,
            clientX  : 0, clientY: 0,
            timeStamp: 0
        };

        // Change in coordinates and time of the pointer
        this.pointerDelta = {
            pageX    : 0, pageY      : 0,
            clientX  : 0, clientY    : 0,
            pageSpeed: 0, clientSpeed: 0,
            timeStamp: 0
        };

        this.downTime  = 0;         // the timeStamp of the starting event
        this.downEvent = null;      // pointerdown/mousedown/touchstart event
        this.prevEvent = null;      // previous action event
        this.tapTime   = 0;         // time of the most recent tap event
        this.prevTap   = null;

        this.startOffset    = { left: 0, right: 0, top: 0, bottom: 0 };
        this.restrictOffset = { left: 0, right: 0, top: 0, bottom: 0 };
        this.snapOffset     = { x: 0, y: 0};

        this.gesture = {
            start: { x: 0, y: 0 },

            startDistance: 0,   // distance between two touches of touchStart
            prevDistance : 0,
            distance     : 0,

            scale: 1,           // gesture.distance / gesture.startDistance

            startAngle: 0,      // angle of line joining two touches
            prevAngle : 0       // angle of the previous gesture event
        };

        this.snapStatus = {
            x       : 0, y       : 0,
            dx      : 0, dy      : 0,
            realX   : 0, realY   : 0,
            snappedX: 0, snappedY: 0,
            anchors : [],
            paths   : [],
            locked  : false,
            changed : false
        };

        this.restrictStatus = {
            dx         : 0, dy         : 0,
            restrictedX: 0, restrictedY: 0,
            snap       : null,
            restricted : false,
            changed    : false
        };

        this.restrictStatus.snap = this.snapStatus;

        this.pointerIsDown   = false;
        this.pointerWasMoved = false;
        this.gesturing       = false;
        this.dragging        = false;
        this.resizing        = false;
        this.resizeAxes      = 'xy';

        this.mouse = false;

        interactions.push(this);

        console.log('new Interaction');
    }

    Interaction.prototype = {
        getPageXY  : function (event, xy) { return   getPageXY(event, xy, this); },
        getClientXY: function (event, xy) { return getClientXY(event, xy, this); },
        setEventXY : function (trgt, src) { return  setEventXY(trgt, src, this); },

        pointerOver: function (event) {
            if (this.prepared || !this.mouse) { return; }

            var curMatches = [],
                prevTargetElement = this.target && this.element,
                eventTarget = (event.target instanceof SVGElementInstance
                    ? event.target.correspondingUseElement
                    : event.target);

            // do nothing if the element is already in an interaction
            if (contains(claimedElements, eventTarget)) { return; }

            this.addPointer(event);

            if (this.target
                && (testIgnore(this.target, eventTarget) || !testAllow(this.target, eventTarget))) {
                // if the eventTarget should be ignored or shouldn't be allowed
                // clear the previous target
                this.target = null;
                this.element = null;
                this.matches = [];
            }

            var elementInteractable = interactables.get(eventTarget),
                elementAction = (elementInteractable
                                 && !testIgnore(elementInteractable, eventTarget)
                                 && testAllow(elementInteractable, eventTarget)
                                 && validateAction(
                                     elementInteractable.getAction(event, this),
                                     elementInteractable));

            function pushCurMatches (interactable, selector) {
                if (interactable
                    && inContext(interactable, eventTarget)
                    && !testIgnore(interactable, eventTarget)
                    && testAllow(interactable, eventTarget)
                    && matchesSelector(eventTarget, selector)) {

                    interactable._element = eventTarget;
                    curMatches.push(interactable);
                }
            }

            if (elementAction) {
                this.target = elementInteractable;
                this.element = elementInteractable._element;
                this.matches = [];
            }
            else {
                interactables.forEachSelector(pushCurMatches);

                if (this.validateSelector(event, curMatches)) {
                    this.matches = curMatches;

                    this.pointerHover(event, this.matches);
                    events.addToElement(eventTarget, 'mousemove', listeners.pointerHover);
                }
                else if (this.target) {
                    var prevTargetChildren = prevTargetElement.querySelectorAll('*');

                    if (contains(prevTargetChildren, eventTarget)) {

                        // reset the elements of the matches to the old target
                        for (var i = 0; i < this.matches.length; i++) {
                            this.matches[i]._element = prevTargetElement;
                        }

                        this.pointerHover(event, this.matches);
                        events.addToElement(this.element, 'mousemove', listeners.pointerHover);
                    }
                    else {
                        this.target = null;
                        this.element = null;
                        this.matches = [];
                    }
                }
            }
        },

        // Check what action would be performed on pointerMove target if a mouse
        // button were pressed and change the cursor accordingly
        pointerHover: function (event, matches) {
            var target = this.target;

            if (!this.prepared && this.mouse) {

                var action;

                if (matches) {
                    action = this.validateSelector(event, matches);
                }
                else if (target) {
                    action = validateAction(target.getAction(this.pointerMoves[0], this), this.target);
                }

                if (target && target.options.styleCursor) {
                    if (action) {
                        document.documentElement.style.cursor = actionCursors[action];
                    }
                    else {
                        document.documentElement.style.cursor = '';
                    }
                }
            }
            else if (this.prepared) {
                this.checkAndPreventDefault(event, target);
            }
        },

        pointerOut: function (event) {
            if (this.prepared) { return; }

            // Remove temporary event listeners for selector Interactables
            var eventTarget = (event.target instanceof SVGElementInstance
                ? event.target.correspondingUseElement
                : event.target);

            if (!interactables.get(eventTarget)) {
                events.removeFromElement(eventTarget, listeners.pointerHover);
            }

            if (this.target && this.target.options.styleCursor && !(this.dragging || this.resizing || this.gesturing)) {
                document.documentElement.style.cursor = '';
            }
        },

        selectorDown: function (event) {
            this.pointerIsDown = true;

            var eventTarget = (event.target instanceof SVGElementInstance
                ? event.target.correspondingUseElement
                : event.target),
                element = eventTarget,
                action;

            this.addPointer(event);

            // Check if the down event hits the current inertia target
            if (this.inertiaStatus.active && this.target.selector) {
                // climb up the DOM tree from the event target
                while (element && element !== document) {

                    // if this element is the current inertia target element
                    if (element === this.inertiaStatus.targetElement
                        // and the prospective action is the same as the ongoing one
                        && validateAction(this.target.getAction(event, this), this.target) === this.prepared) {

                        // stop inertia so that the next move will be a normal one
                        cancelFrame(this.inertiaStatus.i);
                        this.inertiaStatus.active = false;

                        return;
                    }
                    element = element.parentNode;
                }
            }

            // do nothing if interacting
            if (this.dragging || this.resizing || this.gesturing) {
                return;
            }

            var that = this;

            function pushMatches (interactable, selector, context) {
                var elements = ie8MatchesSelector
                    ? context.querySelectorAll(selector)
                    : undefined;

                if (inContext(interactable, element)
                    && !testIgnore(interactable, eventTarget)
                    && testAllow(interactable, eventTarget)
                    && matchesSelector(element, selector, elements)) {

                    interactable._element = element;
                    that.matches.push(interactable);
                }
            }

            if (this.matches.length && /mousedown|pointerdown/i.test(event.type)) {
                action = this.validateSelector(event, this.matches);
            }
            else {
                while (element && element !== document && !action) {
                    this.matches = [];

                    interactables.forEachSelector(pushMatches);

                    action = this.validateSelector(event, this.matches);
                    element = element.parentNode;
                }
            }

            if (action) {
                this.prepared = action;

                return this.pointerDown(event, action);
            }
            else {
                // do these now since pointerDown isn't being called from here
                this.downTime = new Date().getTime();
                this.downEvent = cloneEvent(event);

                this.setEventXY(this.prevCoords, this.pointerMoves[0]);
                this.pointerWasMoved = false;
            }
        },

        // Determine action to be performed on next pointerMove and add appropriate
        // style and event Liseners
        pointerDown: function (event, forceAction) {
            if (!forceAction && this.pointerIsDown) {
                this.checkAndPreventDefault(event, this.target);

                return;
            }

            this.pointerIsDown = true;

            this.addPointer(event);

            // If it is the second touch of a multi-touch gesture, keep the target
            // the same if a target was set by the first touch
            // Otherwise, set the target if there is no action prepared
            if ((this.pointerIds.length < 2 && !this.target) || !this.prepared) {

                var interactable = interactables.get(event.currentTarget);

                if (!testIgnore(interactable, event.target)
                    && testAllow(interactable, event.target)) {
                    this.target = interactable;
                    this.element = interactable._element;
                }
            }

            var target = this.target,
                options = target && target.options;

            if (target && !(this.dragging || this.resizing || this.gesturing)) {
                var action = validateAction(forceAction || target.getAction(event, this), target);

                this.setEventXY(this.startCoords, this.pointerMoves[0]);

                if (!action) {
                    return event;
                }

                if (options.styleCursor) {
                    document.documentElement.style.cursor = actionCursors[action];
                }

                this.resizeAxes = action === 'resizexy'?
                        'xy':
                        action === 'resizex'?
                            'x':
                            action === 'resizey'?
                                'y':
                                '';

                if (action === 'gesture' && this.pointerIds.length < 2) {
                    action = null;
                }

                this.prepared = action;

                this.snapStatus.snappedX = this.snapStatus.snappedY =
                    this.restrictStatus.restrictedX = this.restrictStatus.restrictedY = NaN;

                this.downTime = new Date().getTime();
                this.downEvent = cloneEvent(event);

                this.setEventXY(this.prevCoords, this.pointerMoves[0]);
                this.pointerWasMoved = false;

                this.checkAndPreventDefault(event, target);
            }
            // if inertia is active try to resume action
            else if (this.inertiaStatus.active
                && event.currentTarget === this.inertiaStatus.targetElement
                && target === this.inertiaStatus.target
                && validateAction(target.getAction(event, this), target) === this.prepared) {

                cancelFrame(this.inertiaStatus.i);
                this.inertiaStatus.active = false;
            }
        },

        pointerMove: function (event, preEnd) {
            if (!this.pointerIsDown) { return; }

            if (!(event instanceof InteractEvent)) {
                this.setEventXY(this.curCoords, this.pointerMoves[0]);
            }

            var dx, dy;

            // register movement of more than 1 pixel
            if (!this.pointerWasMoved) {
                dx = this.curCoords.clientX - this.startCoords.clientX;
                dy = this.curCoords.clientY - this.startCoords.clientY;

                this.pointerWasMoved = hypot(dx, dy) > defaultOptions.pointerMoveTolerance;
            }

            if (!this.prepared) { return; }

            if (this.pointerWasMoved
                // ignore movement while inertia is active
                && (!this.inertiaStatus.active || (event instanceof InteractEvent && /inertiastart/.test(event.type)))) {

                // if just starting an action, calculate the pointer speed now
                if (!(this.dragging || this.resizing || this.gesturing)) {
                    setEventDeltas(this.pointerDelta, this.prevCoords, this.curCoords);

                    // check if a drag is in the correct axis
                    if (this.prepared === 'drag') {
                        var absX = Math.abs(dx),
                            absY = Math.abs(dy),
                            targetAxis = this.target.options.dragAxis,
                            axis = (absX > absY ? 'x' : absX < absY ? 'y' : 'xy');

                        // if the movement isn't in the axis of the interactable
                        if (axis !== 'xy' && targetAxis !== 'xy' && targetAxis !== axis) {
                            // cancel the prepared action
                            this.prepared = null;

                            // then try to get a drag from another ineractable

                            var eventTarget = (event.target instanceof SVGElementInstance
                                    ? event.target.correspondingUseElement
                                    : event.target),
                                element = eventTarget;

                            // check element interactables
                            while (element && element !== document) {
                                var elementInteractable = interactables.get(element);

                                if (elementInteractable
                                    && elementInteractable !== this.target
                                    && elementInteractable.getAction(this.downEvent, this) === 'drag'
                                    && checkAxis(axis, elementInteractable)) {
                                    this.prepared = 'drag';
                                    this.target = elementInteractable;
                                    this.element = elementInteractable._element;
                                    break;
                                }

                                element = element.parentNode;
                            }

                            // if there's no drag from element interactables,
                            // check the selector interactables
                            if (!this.prepared) {
                                var getDraggable = function (interactable, selector, context) {
                                    var elements = ie8MatchesSelector
                                        ? context.querySelectorAll(selector)
                                        : undefined;

                                    if (interactable === this.target) { return; }

                                    interactable._element = element;

                                    if (inContext(interactable, eventTarget)
                                        && !testIgnore(interactable, eventTarget)
                                        && testAllow(interactable, eventTarget)
                                        && matchesSelector(element, selector, elements)
                                        && interactable.getAction(this.downEvent, this) === 'drag'
                                        && checkAxis(axis, interactable)) {

                                        return interactable;
                                    }
                                };

                                element = eventTarget;

                                while (element && element !== document) {
                                    var selectorInteractable = interactables.forEachSelector(getDraggable);

                                    if (selectorInteractable) {
                                        this.prepared = 'drag';
                                        this.target = selectorInteractable;
                                        this.element = selectorInteractable._element;
                                        break;
                                    }

                                    element = element.parentNode;
                                }
                            }
                        }
                    }
                }

                var starting = !!this.prepared && !(this.dragging || this.resizing || this.gesturing);

                if (starting && contains(claimedElements, this.element)) {
                    this.stop();
                    return;
                }

                if (this.prepared && this.target) {
                    var target         = this.target,
                        shouldSnap     = checkSnap(target, this.prepared)     && (!target.options.snap.endOnly     || preEnd),
                        shouldRestrict = checkRestrict(target, this.prepared) && (!target.options.restrict.endOnly || preEnd),

                        snapEvent = starting? this.downEvent: event;

                    if (starting) {
                        // claim this element
                        claimedElements.push(this.element);

                        this.prevEvent = this.downEvent;

                        var rect = target.getRect(),
                            snap = target.options.snap,
                            restrict = target.options.restrict;

                        if (rect) {
                            this.startOffset.left = this.startCoords.pageX - rect.left;
                            this.startOffset.top  = this.startCoords.pageY - rect.top;

                            this.startOffset.right  = rect.right  - this.startCoords.pageX;
                            this.startOffset.bottom = rect.bottom - this.startCoords.pageY;
                        }
                        else {
                            this.startOffset.left = this.startOffset.top = this.startOffset.right = this.startOffset.bottom = 0;
                        }

                        if (rect && snap.elementOrigin) {
                            this.snapOffset.x = this.startOffset.left - (rect.width  * snap.elementOrigin.x);
                            this.snapOffset.y = this.startOffset.top  - (rect.height * snap.elementOrigin.y);
                        }
                        else {
                            this.snapOffset.x = this.snapOffset.y = 0;
                        }

                        if (rect && restrict.elementRect) {
                            this.restrictOffset.left = this.startOffset.left - (rect.width  * restrict.elementRect.left);
                            this.restrictOffset.top  = this.startOffset.top  - (rect.height * restrict.elementRect.top);

                            this.restrictOffset.right  = this.startOffset.right  - (rect.width  * (1 - restrict.elementRect.right));
                            this.restrictOffset.bottom = this.startOffset.bottom - (rect.height * (1 - restrict.elementRect.bottom));
                        }
                        else {
                            this.restrictOffset.left = this.restrictOffset.top = this.restrictOffset.right = this.restrictOffset.bottom = 0;
                        }
                    }

                    if (shouldSnap    ) { this.setSnapping   (snapEvent); } else { this.snapStatus    .locked     = false; }
                    if (shouldRestrict) { this.setRestriction(snapEvent); } else { this.restrictStatus.restricted = false; }

                    var shouldMove = (shouldSnap? (this.snapStatus.changed || !this.snapStatus.locked): true)
                                     && (shouldRestrict? (!this.restrictStatus.restricted || (this.restrictStatus.restricted && this.restrictStatus.changed)): true);

                    // move if snapping or restriction doesn't prevent it
                    if (shouldMove) {
                        var action = /resize/.test(this.prepared)? 'resize': this.prepared;
                        if (starting) {
                            this.prevEvent = this[action + 'Start'](this.downEvent);

                            // set snapping and restriction for the move event
                            if (shouldSnap    ) { this.setSnapping   (event); }
                            if (shouldRestrict) { this.setRestriction(event); }
                        }

                        this.prevEvent = this[action + 'Move'](event);
                    }
                }
            }

            if (!(event instanceof InteractEvent)) {
                // set pointer coordinate, time changes and speeds
                setEventDeltas(this.pointerDelta, this.prevCoords, this.curCoords);
                this.setEventXY(this.prevCoords, this.pointerMoves[0]);
            }

            if (this.dragging || this.resizing) {
                autoScroll.edgeMove(event);
            }
        },

        dragStart: function (event) {
            var dragEvent = new InteractEvent(this, event, 'drag', 'start');

            this.dragging = true;

            this.target.fire(dragEvent);

            // reset active dropzones
            this.activeDrops.dropzones = [];
            this.activeDrops.elements  = [];
            this.activeDrops.rects     = [];

            if (!this.dynamicDrop) {
                this.setActiveDrops(this.element);
            }

            var dropEvents = this.getDropEvents(event, dragEvent);

            if (dropEvents.activate) {
                this.fireActiveDrops(dropEvents.activate);
            }

            return dragEvent;
        },

        dragMove: function (event) {
            this.checkAndPreventDefault(event, this.target);

            var target = this.target,
                dragEvent  = new InteractEvent(this, event, 'drag', 'move'),
                draggableElement = this.element,
                drop = this.getDrop(dragEvent, draggableElement);

            this.dropTarget = drop.dropzone;
            this.dropElement = drop.element;

            // Make sure that the target selector draggable's element is
            // restored after dropChecks
            //***~~~
            target._element = draggableElement;

            var dropEvents = this.getDropEvents(event, dragEvent);

            target.fire(dragEvent);

            if (dropEvents.leave) { this.prevDropTarget.fire(dropEvents.leave); }
            if (dropEvents.enter) {     this.dropTarget.fire(dropEvents.enter); }
            if (dropEvents.move ) {     this.dropTarget.fire(dropEvents.move ); }

            this.prevDropTarget  = this.dropTarget;
            this.prevDropElement = this.dropElement;

            return dragEvent;
        },

        resizeStart: function (event) {
            var resizeEvent = new InteractEvent(this, event, 'resize', 'start');

            this.target.fire(resizeEvent);

            this.resizing = true;

            return resizeEvent;
        },

        resizeMove: function (event) {
            this.checkAndPreventDefault(event, this.target);

            var resizeEvent = new InteractEvent(this, event, 'resize', 'move');

            this.target.fire(resizeEvent);

            return resizeEvent;
        },

        gestureStart: function (event) {
            var gestureEvent = new InteractEvent(this, event, 'gesture', 'start');

            gestureEvent.ds = 0;

            this.gesture.startDistance = this.gesture.prevDistance = gestureEvent.distance;
            this.gesture.startAngle = this.gesture.prevAngle = gestureEvent.angle;
            this.gesture.scale = 1;

            this.gesturing = true;

            this.target.fire(gestureEvent);

            return gestureEvent;
        },

        gestureMove: function (event) {
            if (!this.pointerIds.length) {
                return this.prevEvent;
            }

            this.checkAndPreventDefault(event, this.target);

            var gestureEvent;

            gestureEvent = new InteractEvent(this, event, 'gesture', 'move');
            gestureEvent.ds = gestureEvent.scale - this.gesture.scale;

            this.target.fire(gestureEvent);

            this.gesture.prevAngle = gestureEvent.angle;
            this.gesture.prevDistance = gestureEvent.distance;

            if (gestureEvent.scale !== Infinity &&
                gestureEvent.scale !== null &&
                gestureEvent.scale !== undefined  &&
                !isNaN(gestureEvent.scale)) {

                this.gesture.scale = gestureEvent.scale;
            }

            return gestureEvent;
        },

        // End interact move events and stop auto-scroll unless inertia is enabled
        pointerUp: function (event) {
            var endEvent,
                target = this.target,
                options = target && target.options,
                inertiaOptions = options && options.inertia,
                inertiaStatus = this.inertiaStatus;

            if (this.dragging || this.resizing || this.gesturing) {

                if (this.inertiaStatus.active) { return; }

                var deltaSource = options.deltaSource,
                    pointerSpeed = this.pointerDelta[deltaSource + 'Speed'],
                    now = new Date().getTime(),
                    inertiaPossible = false,
                    inertia = false,
                    smoothEnd = false,
                    endSnap = checkSnap(target, this.prepared) && options.snap.endOnly,
                    endRestrict = checkRestrict(target, this.prepared) && options.restrict.endOnly,
                    dx = 0,
                    dy = 0,
                    startEvent;

                // check if inertia should be started
                inertiaPossible = (options.inertiaEnabled
                                   && this.prepared !== 'gesture'
                                   && contains(inertiaOptions.actions, this.prepared)
                                   && event !== inertiaStatus.startEvent);

                inertia = (inertiaPossible
                           && (now - this.curCoords.timeStamp) < 50
                           && pointerSpeed > inertiaOptions.minSpeed
                           && pointerSpeed > inertiaOptions.endSpeed);

                if (inertiaPossible && !inertia && (endSnap || endRestrict)) {

                    var snapRestrict = {};

                    snapRestrict.snap = snapRestrict.restrict = snapRestrict;

                    if (endSnap) {
                        this.setSnapping(event, snapRestrict);
                        if (snapRestrict.locked) {
                            dx += snapRestrict.dx;
                            dy += snapRestrict.dy;
                        }
                    }

                    if (endRestrict) {
                        this.setRestriction(event, snapRestrict);
                        if (snapRestrict.restricted) {
                            dx += snapRestrict.dx;
                            dy += snapRestrict.dy;
                        }
                    }

                    if (dx || dy) {
                        smoothEnd = true;
                    }
                }

                if (inertia || smoothEnd) {
                    if (events.useAttachEvent) {
                        // make a copy of the pointerdown event because IE8
                        // http://stackoverflow.com/a/3533725/2280888
                        extend(inertiaStatus.pointerUp, event);
                    }
                    else {
                        inertiaStatus.pointerUp = event;
                    }

                    inertiaStatus.startEvent = startEvent = new InteractEvent(this, event, this.prepared, 'inertiastart');
                    target.fire(inertiaStatus.startEvent);

                    inertiaStatus.target = target;
                    inertiaStatus.targetElement = this.element;
                    inertiaStatus.t0 = now;

                    if (inertia) {
                        inertiaStatus.vx0 = this.pointerDelta[deltaSource + 'VX'];
                        inertiaStatus.vy0 = this.pointerDelta[deltaSource + 'VY'];
                        inertiaStatus.v0 = pointerSpeed;

                        this.calcInertia(inertiaStatus);

                        var page = this.getPageXY(this.pointerMoves[0]),
                            origin = getOriginXY(target, this.element),
                            statusObject;

                        page.x = page.x + (inertia? inertiaStatus.xe: 0) - origin.x;
                        page.y = page.y + (inertia? inertiaStatus.ye: 0) - origin.y;

                        statusObject = {
                            useStatusXY: true,
                            x: page.x,
                            y: page.y,
                            dx: 0,
                            dy: 0,
                            snap: null
                        };

                        statusObject.snap = statusObject;

                        dx = dy = 0;

                        if (endSnap) {
                            var snap = this.setSnapping(event, statusObject);

                            if (snap.locked) {
                                dx += snap.dx;
                                dy += snap.dy;
                            }
                        }

                        if (endRestrict) {
                            var restrict = this.setRestriction(event, statusObject);

                            if (restrict.restricted) {
                                dx += restrict.dx;
                                dy += restrict.dy;
                            }
                        }

                        inertiaStatus.modifiedXe += dx;
                        inertiaStatus.modifiedYe += dy;

                        inertiaStatus.i = reqFrame(this.boundInertiaFrame);
                    }
                    else {
                        inertiaStatus.smoothEnd = true;
                        inertiaStatus.xe = dx;
                        inertiaStatus.ye = dy;

                        inertiaStatus.sx = inertiaStatus.sy = 0;

                        inertiaStatus.i = reqFrame(this.boundSmoothEndFrame);
                    }

                    inertiaStatus.active = true;
                    return;
                }

                if (endSnap || endRestrict) {
                    // fire a move event at the snapped coordinates
                    this.pointerMove(event, true);
                }
            }

            if (this.dragging) {
                endEvent = new InteractEvent(this, event, 'drag', 'end');

                var dropEvent,
                    draggableElement = this.element,
                    drop = this.getDrop(endEvent, draggableElement);

                this.dropTarget = drop.dropzone;
                this.dropElement = drop.element;

                // getDrop changes target._element
                target._element = draggableElement;

                // get the most apprpriate dropzone based on DOM depth and order
                if (this.dropTarget) {
                    dropEvent = new InteractEvent(this, event, 'drop', null, this.dropElement, draggableElement);

                    endEvent.dropzone = this.dropElement;
                }

                // if there was a prevDropTarget (perhaps if for some reason this
                // dragend happens without the mouse moving of the previous drop
                // target)
                else if (this.prevDropTarget) {
                    var dragLeaveEvent = new InteractEvent(this, event, 'drag', 'leave', this.dropElement, draggableElement);

                    this.prevDropTarget.fire(dragLeaveEvent, draggableElement);

                    endEvent.dragLeave = this.prevDropElement;
                }

                var dropEvents = this.getDropEvents(event, endEvent);

                target.fire(endEvent);

                if (dropEvents.leave) { this.prevDropTarget.fire(dropEvents.leave); }
                if (dropEvents.enter) {     this.dropTarget.fire(dropEvents.enter); }
                if (dropEvents.drop ) {     this.dropTarget.fire(dropEvents.drop ); }
                if (dropEvents.deactivate) {
                    this.fireActiveDrops(dropEvents.deactivate);
                }
            }
            else if (this.resizing) {
                endEvent = new InteractEvent(this, event, 'resize', 'end');
                target.fire(endEvent);
            }
            else if (this.gesturing) {
                endEvent = new InteractEvent(this, event, 'gesture', 'end');
                target.fire(endEvent);
            }

            this.stop(event);
        },

        collectDrops: function (element) {
            var drops = [],
                elements = [],
                i;

            element = element || this.element;

            // collect all dropzones and their elements which qualify for a drop
            for (i = 0; i < dropzones.length; i++) {
                var current = dropzones[i];

                // test the draggable element against the dropzone's accept setting
                if ((isElement(current.options.accept) && current.options.accept !== element)
                    || (isString(current.options.accept)
                        && !matchesSelector(element, current.options.accept))) {

                    continue;
                }

                // query for new elements if necessary
                if (current.selector) {
                    current._dropElements = current._context.querySelectorAll(current.selector);
                }

                for (var j = 0, len = current._dropElements.length; j < len; j++) {
                    var currentElement = current._dropElements[j];

                    if (currentElement === element) {
                        continue;
                    }

                    drops.push(current);
                    elements.push(currentElement);
                }
            }

            return {
                dropzones: drops,
                elements: elements
            };
        },

        fireActiveDrops: function (event) {
            var i,
                current,
                currentElement,
                prevElement;

            // loop through all active dropzones and trigger event
            for (i = 0; i < this.activeDrops.dropzones.length; i++) {
                current = this.activeDrops.dropzones[i];
                currentElement = this.activeDrops.elements [i];

                // prevent trigger of duplicate events on same element
                if (currentElement !== prevElement) {
                    // set current element as event target
                    event.target = currentElement;
                    current.fire(event);
                }
                prevElement = currentElement;
            }
        },

        // Collect a new set of possible drops and save them in activeDrops.
        // setActiveDrops should always be called when a drag has just started or a
        // drag event happens while dynamicDrop is true
        setActiveDrops: function (dragElement) {
            // get dropzones and their elements that could recieve the draggable
            var possibleDrops = this.collectDrops(dragElement, true);

            this.activeDrops.dropzones = possibleDrops.dropzones;
            this.activeDrops.elements  = possibleDrops.elements;
            this.activeDrops.rects     = [];

            for (var i = 0; i < this.activeDrops.dropzones.length; i++) {
                this.activeDrops.rects[i] = this.activeDrops.dropzones[i].getRect(this.activeDrops.elements[i]);
            }
        },

        getDrop: function (event, dragElement) {
            var validDrops = [];

            if (dynamicDrop) {
                this.setActiveDrops(dragElement);
            }

            // collect all dropzones and their elements which qualify for a drop
            for (var j = 0; j < this.activeDrops.dropzones.length; j++) {
                var current        = this.activeDrops.dropzones[j],
                    currentElement = this.activeDrops.elements [j],
                    rect           = this.activeDrops.rects    [j];

                validDrops.push(current.dropCheck(event, this.target, dragElement, rect)
                                ? currentElement
                                : null);
            }

            // get the most apprpriate dropzone based on DOM depth and order
            var dropIndex = indexOfDeepestElement(validDrops),
                dropzone  = this.activeDrops.dropzones[dropIndex] || null,
                element   = this.activeDrops.elements [dropIndex] || null;

            if (dropzone && dropzone.selector) {
                dropzone._element = element;
            }

            return {
                dropzone: dropzone,
                element: element
            };
        },

        getDropEvents: function (pointerEvent, dragEvent) {
            var dragLeaveEvent = null,
                dragEnterEvent = null,
                dropActivateEvent = null,
                dropDectivateEvent = null,
                dropMoveEvent = null,
                dropEvent = null;

            if (this.dropElement !== this.prevDropElement) {
                // if there was a prevDropTarget, create a dragleave event
                if (this.prevDropTarget) {
                    dragLeaveEvent = new InteractEvent(this, pointerEvent, 'drag', 'leave', this.prevDropElement, dragEvent.target);
                    dragLeaveEvent.draggable = dragEvent.interactable;
                    dragEvent.dragLeave = this.prevDropElement;
                    dragEvent.prevDropzone = this.prevDropTarget;
                }
                // if the dropTarget is not null, create a dragenter event
                if (this.dropTarget) {
                    dragEnterEvent = new InteractEvent(this, pointerEvent, 'drag', 'enter', this.dropElement, dragEvent.target);
                    dragEnterEvent.draggable = dragEvent.interactable;
                    dragEvent.dragEnter = this.dropElement;
                    dragEvent.dropzone = this.dropTarget;
                }
            }

            if (dragEvent.type === 'dragend' && this.dropTarget) {
                dropEvent = new InteractEvent(this, pointerEvent, 'drop', null, this.dropElement, dragEvent.target);
                dropEvent.draggable = dragEvent.interactable;
                dragEvent.dropzone = this.dropTarget;
            }
            if (dragEvent.type === 'dragstart') {
                dropActivateEvent = new InteractEvent(this, pointerEvent, 'drop', 'activate', null, dragEvent.target);
                dropActivateEvent.draggable = dragEvent.interactable;
            }
            if (dragEvent.type === 'dragend') {
                dropDectivateEvent = new InteractEvent(this, pointerEvent, 'drop', 'deactivate', null, dragEvent.target);
                dropDectivateEvent.draggable = dragEvent.interactable;
            }
            if (dragEvent.type === 'dragmove' && this.dropTarget) {
                dropMoveEvent = {
                    target       : this.dropElement,
                    relatedTarget: dragEvent.target,
                    draggable    : dragEvent.interactable,
                    dragmove     : dragEvent,
                    type         : 'dropmove',
                    timeStamp    : dragEvent.timeStamp
                };
                dragEvent.dropzone = this.dropTarget;
            }

            return {
                enter       : dragEnterEvent,
                leave       : dragLeaveEvent,
                activate    : dropActivateEvent,
                deactivate  : dropDectivateEvent,
                move        : dropMoveEvent,
                drop        : dropEvent
            };
        },

        currentAction: function () {
            return (this.dragging && 'drag') || (this.resizing && 'resize') || (this.gesturing && 'gesture') || null;
        },

        clearTargets: function () {
            if (this.target && !this.target.selector) {
                this.target = this.element = null;
            }

            this.dropTarget = this.dropElement = this.prevDropTarget = this.prevDropElement = null;
        },

        stop: function (event) {
            if (this.dragging || this.resizing || this.gesturing) {
                autoScroll.stop();
                this.matches = [];

                var target = this.target;

                if (target.options.styleCursor) {
                    document.documentElement.style.cursor = '';
                }

                // prevent Default only if were previously interacting
                if (event && isFunction(event.preventDefault)) {
                    this.checkAndPreventDefault(event, target);
                }

                if (this.dragging) {
                    this.activeDrops.dropzones = this.activeDrops.elements = this.activeDrops.rects = null;

                    for (var i = 0; i < dropzones.length; i++) {
                        if (dropzones[i].selector) {
                            dropzones[i]._dropElements = null;
                        }
                    }
                }

                // unclaim owned element if this had been interacting
                claimedElements.splice(claimedElements.indexOf(this.element), 1);

                this.clearTargets();
            }

            this.pointerIsDown = this.snapStatus.locked = this.dragging = this.resizing = this.gesturing = false;
            this.prepared = this.prevEvent = null;
            this.inertiaStatus.resumeDx = this.inertiaStatus.resumeDy = 0;

            // unclaim owned pointers
            for (var j = 0; j < this.pointerIds.length; j++) {
                var claimedPointerIndex = indexOf(claimedPointers, this.pointerIds[j]);

                if (claimedPointerIndex !== -1) {
                    claimedPointers.splice(claimedPointerIndex, 1);
                }
            }

            this.pointerIds.splice(0);
            // pointerMoves should be retained
            //this.pointerMoves.splice(0);

            // delete interaction if it's not the only one and is not a mouse interaction
            if (interactions.length > 1 && !this.mouse) {
                interactions.splice(indexOf(interactions, this), 1);
            }
        },

        inertiaFrame: function () {
            var inertiaStatus = this.inertiaStatus,
                options = inertiaStatus.target.options.inertia,
                lambda = options.resistance,
                t = new Date().getTime() / 1000 - inertiaStatus.t0;

            if (t < inertiaStatus.te) {

                var progress =  1 - (Math.exp(-lambda * t) - inertiaStatus.lambda_v0) / inertiaStatus.one_ve_v0;

                if (inertiaStatus.modifiedXe === inertiaStatus.xe && inertiaStatus.modifiedYe === inertiaStatus.ye) {
                    inertiaStatus.sx = inertiaStatus.xe * progress;
                    inertiaStatus.sy = inertiaStatus.ye * progress;
                }
                else {
                    var quadPoint = getQuadraticCurvePoint(
                            0, 0,
                            inertiaStatus.xe, inertiaStatus.ye,
                            inertiaStatus.modifiedXe, inertiaStatus.modifiedYe,
                            progress);

                    inertiaStatus.sx = quadPoint.x;
                    inertiaStatus.sy = quadPoint.y;
                }

                this.pointerMove(inertiaStatus.startEvent);

                inertiaStatus.i = reqFrame(this.boundInertiaFrame);
            }
            else {
                inertiaStatus.sx = inertiaStatus.modifiedXe;
                inertiaStatus.sy = inertiaStatus.modifiedYe;

                this.pointerMove(inertiaStatus.startEvent);

                inertiaStatus.active = false;
                this.pointerUp(inertiaStatus.startEvent);
            }
        },

        smoothEndFrame: function () {
            var inertiaStatus = this.inertiaStatus,
                t = new Date().getTime() - inertiaStatus.t0,
                duration = inertiaStatus.target.options.inertia.smoothEndDuration;

            if (t < duration) {
                inertiaStatus.sx = easeOutQuad(t, 0, inertiaStatus.xe, duration);
                inertiaStatus.sy = easeOutQuad(t, 0, inertiaStatus.ye, duration);

                this.pointerMove(inertiaStatus.startEvent);

                inertiaStatus.i = reqFrame(this.boundSmoothEndFrame);
            }
            else {
                inertiaStatus.active = false;
                inertiaStatus.smoothEnd = false;

                this.pointerMove(inertiaStatus.startEvent);
                this.pointerUp(inertiaStatus.startEvent);
            }
        },

        addPointer: function (event, type) {
            type = type || event.type;

            if (/touch/.test(event.type)) {
                var touches = event.changedTouches;

                for (var i = 0; i < touches.length; i++) {
                    this.addPointer(touches[i], type);
                }

                return;
            }

            // dont add the event if it's not the same pointer type as the previous event
            if (this.pointerIds.length && this.pointerMoves[0].pointerType !== event.pointerType) {
                return;
            }

            var id = getPointerId(event),
                index = indexOf(this.pointerIds, id);

            if (index === -1) {
                var claimedPointerIndex = indexOf(claimedPointers, id);

                // don't add if the pointer is owned by another interaction
                if (claimedPointerIndex !== -1) {
                    return;
                }

                index = this.pointerIds.length;
                this.pointerIds.push(id);

                // move events are kept so that multi-touch properties can still be
                // calculated at the end of a gesture; use pointerIds index
                this.pointerMoves[index] = event;
            }
            else {
                if (!contains(claimedPointers, id)) {
                    claimedPointers.push(id);
                }

                this.pointerMoves[index] = event;
            }
        },

        removePointer: function (event) {
            var id = getPointerId(event),
                index = indexOf(this.pointerIds, id);

            if (index === -1) { return; }

            this.pointerIds.splice(index, 1);
            claimedPointers.splice(indexOf(claimedPointers, id));

            // move events are kept so that multi-touch properties can still be
            // calculated at the end of a GestureEvnt sequence
            //this.pointerMoves.splice(index, 1);
        },

        recordPointers: function (event, type) {
            var index = indexOf(this.pointerIds, getPointerId(event));

            if (index === -1) { return; }

            type = type || event.type;

            if (/move/i.test(type)) {
                this.pointerMoves[index] = event;
            }
            else if (/up|end|cancel/i.test(type)) {
                this.removePointer(event);
            }
        },

        recordTouches: function (event) {
            var touches = event.changedTouches;

            for (var i = 0; i < touches.length; i++) {
                this.recordPointers(touches[i], event.type);
            }

            return;
        },

        fireTaps: function (event, targets, elements) {
            var tap = {},
                i;

            extend(tap, event);

            tap.preventDefault           = preventOriginalDefault;
            tap.stopPropagation          = InteractEvent.prototype.stopPropagation;
            tap.stopImmediatePropagation = InteractEvent.prototype.stopImmediatePropagation;

            tap.timeStamp     = new Date().getTime();
            tap.originalEvent = event;
            tap.dt            = tap.timeStamp - this.downTime;
            tap.type          = 'tap';

            var interval = tap.timeStamp - this.tapTime,
                dbl = (this.prevTap && this.prevTap.type !== 'doubletap'
                       && this.prevTap.target === tap.target
                       && interval < 500);

            this.tapTime = tap.timeStamp;

            for (i = 0; i < targets.length; i++) {
                var origin = getOriginXY(targets[i], elements[i]);

                tap.pageX -= origin.x;
                tap.pageY -= origin.y;
                tap.clientX -= origin.x;
                tap.clientY -= origin.y;

                tap.currentTarget = elements[i];
                targets[i].fire(tap);

                if (tap.immediatePropagationStopped
                    ||(tap.propagationStopped && targets[i + 1] !== tap.currentTarget)) {
                    break;
                }
            }

            if (dbl) {
                var doubleTap = {};

                extend(doubleTap, tap);

                doubleTap.dt   = interval;
                doubleTap.type = 'doubletap';

                for (i = 0; i < targets.length; i++) {
                    doubleTap.currentTarget = elements[i];
                    targets[i].fire(doubleTap);

                    if (doubleTap.immediatePropagationStopped
                        ||(doubleTap.propagationStopped && targets[i + 1] !== doubleTap.currentTarget)) {
                        break;
                    }
                }

                this.prevTap = doubleTap;
            }
            else {
                this.prevTap = tap;
            }
        },

        collectTaps: function (event) {
            if(this.downEvent) {
                if (this.pointerWasMoved
                    || this.downEvent.target !== event.target) {
                    return;
                }
            }

            var tapTargets = [],
                tapElements = [];

            var eventTarget = (event.target instanceof SVGElementInstance
                    ? event.target.correspondingUseElement
                    : event.target),
                element = eventTarget;

            function collectSelectorTaps (interactable, selector, context) {
                var elements = ie8MatchesSelector
                        ? context.querySelectorAll(selector)
                        : undefined;

                if (element !== document
                    && inContext(interactable, element)
                    && !testIgnore(interactable, eventTarget)
                    && testAllow(interactable, eventTarget)
                    && matchesSelector(element, selector, elements)) {

                    tapTargets.push(interactable);
                    tapElements.push(element);
                }
            }

            while (element) {
                if (interact.isSet(element)) {
                    tapTargets.push(interact(element));
                    tapElements.push(element);
                }

                interactables.forEachSelector(collectSelectorTaps);

                element = element.parentNode;
            }

            if (tapTargets.length) {
                this.fireTaps(event, tapTargets, tapElements);
            }
        },

        validateSelector: function (event, matches) {
            for (var i = 0, len = matches.length; i < len; i++) {
                var match = matches[i],
                    action = validateAction(match.getAction(event, this), match);

                if (action) {
                    this.target = match;
                    this.element = match._element;

                    return action;
                }
            }
        },

        setSnapping: function (event, status) {
            var snap = this.target.options.snap,
                anchors = snap.anchors,
                page,
                closest,
                range,
                inRange,
                snapChanged,
                dx,
                dy,
                distance,
                i, len;

            status = status || this.snapStatus;

            if (status.useStatusXY) {
                page = { x: status.x, y: status.y };
            }
            else {
                var origin = getOriginXY(this.target);

                page = this.getPageXY(this.pointerMoves[0]);

                page.x -= origin.x;
                page.y -= origin.y;
            }

            page.x -= this.inertiaStatus.resumeDx;
            page.y -= this.inertiaStatus.resumeDy;

            status.realX = page.x;
            status.realY = page.y;

            // change to infinite range when range is negative
            if (snap.range < 0) { snap.range = Infinity; }

            // create an anchor representative for each path's returned point
            if (snap.mode === 'path') {
                anchors = [];

                for (i = 0, len = snap.paths.length; i < len; i++) {
                    var path = snap.paths[i];

                    if (isFunction(path)) {
                        path = path(page.x, page.y);
                    }

                    anchors.push({
                        x: isNumber(path.x) ? path.x : page.x,
                        y: isNumber(path.y) ? path.y : page.y,

                        range: isNumber(path.range)? path.range: snap.range
                    });
                }
            }

            if ((snap.mode === 'anchor' || snap.mode === 'path') && anchors.length) {
                closest = {
                    anchor: null,
                    distance: 0,
                    range: 0,
                    dx: 0,
                    dy: 0
                };

                for (i = 0, len = anchors.length; i < len; i++) {
                    var anchor = anchors[i];

                    range = isNumber(anchor.range)? anchor.range: snap.range;

                    dx = anchor.x - page.x + this.snapOffset.x;
                    dy = anchor.y - page.y + this.snapOffset.y;
                    distance = hypot(dx, dy);

                    inRange = distance < range;

                    // Infinite anchors count as being out of range
                    // compared to non infinite ones that are in range
                    if (range === Infinity && closest.inRange && closest.range !== Infinity) {
                        inRange = false;
                    }

                    if (!closest.anchor || (inRange?
                        // is the closest anchor in range?
                        (closest.inRange && range !== Infinity)?
                            // the pointer is relatively deeper in this anchor
                            distance / range < closest.distance / closest.range:
                            //the pointer is closer to this anchor
                            distance < closest.distance:
                        // The other is not in range and the pointer is closer to this anchor
                        (!closest.inRange && distance < closest.distance))) {

                        if (range === Infinity) {
                            inRange = true;
                        }

                        closest.anchor = anchor;
                        closest.distance = distance;
                        closest.range = range;
                        closest.inRange = inRange;
                        closest.dx = dx;
                        closest.dy = dy;

                        status.range = range;
                    }
                }

                inRange = closest.inRange;
                snapChanged = (closest.anchor.x !== status.x || closest.anchor.y !== status.y);

                status.snappedX = closest.anchor.x;
                status.snappedY = closest.anchor.y;
                status.dx = closest.dx;
                status.dy = closest.dy;
            }
            else if (snap.mode === 'grid') {
                var gridx = Math.round((page.x - snap.gridOffset.x - this.snapOffset.x) / snap.grid.x),
                    gridy = Math.round((page.y - snap.gridOffset.y - this.snapOffset.y) / snap.grid.y),

                    newX = gridx * snap.grid.x + snap.gridOffset.x + this.snapOffset.x,
                    newY = gridy * snap.grid.y + snap.gridOffset.y + this.snapOffset.y;

                dx = newX - page.x;
                dy = newY - page.y;

                distance = hypot(dx, dy);

                inRange = distance < snap.range;
                snapChanged = (newX !== status.snappedX || newY !== status.snappedY);

                status.snappedX = newX;
                status.snappedY = newY;
                status.dx = dx;
                status.dy = dy;

                status.range = snap.range;
            }

            status.changed = (snapChanged || (inRange && !status.locked));
            status.locked = inRange;

            return status;
        },

        setRestriction: function (event, status) {
            var target = this.target,
                restrict = target && target.options.restrict,
                restriction = restrict && restrict[this.prepared],
                page;

            if (!restriction) {
                return status;
            }

            status = status || this.restrictStatus;

            page = status.useStatusXY
                    ? page = { x: status.x, y: status.y }
                    : page = this.getPageXY(this.pointerMoves[0]);

            if (status.snap && status.snap.locked) {
                page.x += status.snap.dx || 0;
                page.y += status.snap.dy || 0;
            }

            page.x -= this.inertiaStatus.resumeDx;
            page.y -= this.inertiaStatus.resumeDy;

            status.dx = 0;
            status.dy = 0;
            status.restricted = false;

            var rect;

            if (restriction === 'parent') {
                restriction = this.element.parentNode;
            }
            else if (restriction === 'self') {
                restriction = this.element;
            }

            if (isElement(restriction)) {
                rect = getElementRect(restriction);
            }
            else {
                if (isFunction(restriction)) {
                    restriction = restriction(page.x, page.y, this.element);
                }

                rect = restriction;

                // object is assumed to have
                // x, y, width, height or
                // left, top, right, bottom
                if ('x' in restriction && 'y' in restriction) {
                    rect = {
                        left  : restriction.x,
                        top   : restriction.y,
                        right : restriction.x + restriction.width,
                        bottom: restriction.y + restriction.height
                    };
                }
            }

            var restrictedX = Math.max(Math.min(rect.right  - this.restrictOffset.right , page.x), rect.left + this.restrictOffset.left),
                restrictedY = Math.max(Math.min(rect.bottom - this.restrictOffset.bottom, page.y), rect.top  + this.restrictOffset.top );

            status.dx = restrictedX - page.x;
            status.dy = restrictedY - page.y;

            status.changed = status.restrictedX !== restrictedX || status.restrictedY !== restrictedY;
            status.restricted = !!(status.dx || status.dy);

            status.restrictedX = restrictedX;
            status.restrictedY = restrictedY;

            return status;
        },

        checkAndPreventDefault: function (event, interactable) {
            if (!(interactable = interactable || this.target)) { return; }

            var options = interactable.options,
                prevent = options.preventDefault;

            if (prevent === 'auto' && !/^input$|^textarea$/i.test(interactable._element.nodeName)) {
                // do not preventDefault on pointerdown if the prepared action is a drag
                // and dragging can only start from a certain direction - this allows
                // a touch to pan the viewport if a drag isn't in the right direction
                if (/down|start/i.test(event.type)
                    && this.prepared === 'drag' && options.dragAxis !== 'xy') {

                    return;
                }

                event.preventDefault();
                return;
            }

            if (prevent === true) {
                event.preventDefault();
                return;
            }
        },

        calcInertia: function (status) {
            var inertiaOptions = status.target.options.inertia,
                lambda = inertiaOptions.resistance,
                inertiaDur = -Math.log(inertiaOptions.endSpeed / status.v0) / lambda;

            status.x0 = this.prevEvent.pageX;
            status.y0 = this.prevEvent.pageY;
            status.t0 = status.startEvent.timeStamp / 1000;
            status.sx = status.sy = 0;

            status.modifiedXe = status.xe = (status.vx0 - inertiaDur) / lambda;
            status.modifiedYe = status.ye = (status.vy0 - inertiaDur) / lambda;
            status.te = inertiaDur;

            status.lambda_v0 = lambda / status.v0;
            status.one_ve_v0 = 1 - inertiaOptions.endSpeed / status.v0;
        }

    };

    function getInteractionFromEvent (pointer) {
        var i = 0, len = interactions.length,
            mouseEvent = /mouse/.test(pointer.type),
            interaction;

        // if it's a mouse interaction
        if (!(supportsTouch || supportsPointerEvent)
            || mouseEvent) {

            // find the interaction specifically for mouse
            for (i = 0; i < len; i++) {
                if (interactions[i].mouse) {
                    return interactions[i];
                }
            }

            // or create a new interaction for mouse
            interaction = new Interaction();
            interaction.mouse = true;

            return interaction;
        }

        // using "inertiastart" InteractEvent
        if (pointer instanceof InteractEvent && /inertiastart/.test(pointer.type)) {
            for (i = 0; i < len; i++) {
                if (interactions[i].inertiaStatus.startEvent === pointer) {
                    return interactions[i];
                }
            }
        }

        var id = getPointerId(pointer);

        // get interaction that has this pointer
        for (i = 0; i < len; i++) {
            if (contains(interactions[i].pointerIds, id)) {
                return interactions[i];
            }
        }

        // at this stage, a pointerUp should not return an interaction
        if (/up|end|out/i.test(pointer.type)) {
            return null;
        }

        // should get interaction whose target is in the event path

        // get first idle interaction
        for (i = 0; i < len; i++) {
            interaction = interactions[i];

            if (!interaction.pointerIsDown && !(!mouseEvent && interaction.mouse)) {
                var pointerIndex = interaction.pointerIds.length;

                interaction.pointerIds.push(id);

                interaction.pointerMoves[pointerIndex] = pointer;


                return interaction;
            }
        }

        return new Interaction();
    }

    function doOnInteraction (method) {
        return (function (event) {
            var interaction;

            if (supportsTouch && /touch/.test(event.type)) {
                for (var i = 0; i < event.changedTouches.length; i++) {
                    var pointer = event.changedTouches[i];

                    interaction = getInteractionFromEvent(pointer);

                    if (!interaction) { continue; }

                    interaction[method].apply(interaction, arguments);
                }
            }
            else {
                interaction = getInteractionFromEvent(event);

                if (!interaction) { return; }

                interaction[method].apply(interaction, arguments);
            }
        });
    }

    function InteractEvent (interaction, event, action, phase, element, related) {
        var client,
            page,
            target      = interaction.target,
            snapStatus  = interaction.snapStatus,
            restrictStatus  = interaction.restrictStatus,
            pointerMoves= interaction.pointerMoves,
            deltaSource = (target && target.options || defaultOptions).deltaSource,
            sourceX     = deltaSource + 'X',
            sourceY     = deltaSource + 'Y',
            options     = target? target.options: defaultOptions,
            origin      = getOriginXY(target, element),
            starting    = phase === 'start',
            ending      = phase === 'end';

        element = element || interaction.element;

        if (action === 'gesture') {
            var average = touchAverage(pointerMoves);

            page   = { x: (average.pageX   - origin.x), y: (average.pageY   - origin.y) };
            client = { x: (average.clientX - origin.x), y: (average.clientY - origin.y) };
        }
        else {
            var pointer = (event instanceof InteractEvent)? event : pointerMoves[0];

            page   = interaction.getPageXY(pointer);
            client = interaction.getClientXY(pointer);

            page.x -= origin.x;
            page.y -= origin.y;

            client.x -= origin.x;
            client.y -= origin.y;

            if (checkSnap(target, action) && !(starting && options.snap.elementOrigin)) {

                this.snap = {
                    range  : snapStatus.range,
                    locked : snapStatus.locked,
                    x      : snapStatus.snappedX,
                    y      : snapStatus.snappedY,
                    realX  : snapStatus.realX,
                    realY  : snapStatus.realY,
                    dx     : snapStatus.dx,
                    dy     : snapStatus.dy
                };

                if (snapStatus.locked) {
                    page.x += snapStatus.dx;
                    page.y += snapStatus.dy;
                    client.x += snapStatus.dx;
                    client.y += snapStatus.dy;
                }
            }
        }

        if (checkRestrict(target, action) && !(starting && options.restrict.elementRect) && restrictStatus.restricted) {
            page.x += restrictStatus.dx;
            page.y += restrictStatus.dy;
            client.x += restrictStatus.dx;
            client.y += restrictStatus.dy;

            this.restrict = {
                dx: restrictStatus.dx,
                dy: restrictStatus.dy
            };
        }

        this.pageX     = page.x;
        this.pageY     = page.y;
        this.clientX   = client.x;
        this.clientY   = client.y;

        this.x0        = interaction.startCoords.pageX;
        this.y0        = interaction.startCoords.pageY;
        this.clientX0  = interaction.startCoords.clientX;
        this.clientY0  = interaction.startCoords.clientY;
        this.ctrlKey   = event.ctrlKey;
        this.altKey    = event.altKey;
        this.shiftKey  = event.shiftKey;
        this.metaKey   = event.metaKey;
        this.button    = event.button;
        this.target    = element;
        this.t0        = interaction.downTime;
        this.type      = action + (phase || '');

        this.interaction = interaction;
        this.interactable = target;

        var inertiaStatus = interaction.inertiaStatus;

        if (inertiaStatus.active) {
            this.detail = 'inertia';
        }

        if (related) {
            this.relatedTarget = related;
        }

        // end event dx, dy is difference between start and end points
        if (ending || action === 'drop') {
            if (deltaSource === 'client') {
                this.dx = client.x - interaction.startCoords.clientX;
                this.dy = client.y - interaction.startCoords.clientY;
            }
            else {
                this.dx = page.x - interaction.startCoords.pageX;
                this.dy = page.y - interaction.startCoords.pageY;
            }
        }
        // copy properties from previousmove if starting inertia
        else if (phase === 'inertiastart') {
            this.dx = interaction.prevEvent.dx;
            this.dy = interaction.prevEvent.dy;
        }
        else {
            if (deltaSource === 'client') {
                this.dx = client.x - interaction.prevEvent.clientX;
                this.dy = client.y - interaction.prevEvent.clientY;
            }
            else {
                this.dx = page.x - interaction.prevEvent.pageX;
                this.dy = page.y - interaction.prevEvent.pageY;
            }
        }
        if (interaction.prevEvent && interaction.prevEvent.detail === 'inertia'
            && !inertiaStatus.active && options.inertia.zeroResumeDelta) {

            inertiaStatus.resumeDx += this.dx;
            inertiaStatus.resumeDy += this.dy;

            this.dx = this.dy = 0;
        }

        if (action === 'resize') {
            if (options.squareResize || event.shiftKey) {
                if (interaction.resizeAxes === 'y') {
                    this.dx = this.dy;
                }
                else {
                    this.dy = this.dx;
                }
                this.axes = 'xy';
            }
            else {
                this.axes = interaction.resizeAxes;

                if (interaction.resizeAxes === 'x') {
                    this.dy = 0;
                }
                else if (interaction.resizeAxes === 'y') {
                    this.dx = 0;
                }
            }
        }
        else if (action === 'gesture') {
            this.touches = (PointerEvent
                            ? [pointerMoves[0], pointerMoves[1]]
                            : event.touches);

            if (starting) {
                this.distance = touchDistance(pointerMoves, deltaSource);
                this.box      = touchBBox(pointerMoves);
                this.scale    = 1;
                this.ds       = 0;
                this.angle    = touchAngle(pointerMoves, undefined, deltaSource);
                this.da       = 0;
            }
            else if (ending || event instanceof InteractEvent) {
                this.distance = interaction.prevEvent.distance;
                this.box      = interaction.prevEvent.box;
                this.scale    = interaction.prevEvent.scale;
                this.ds       = this.scale - 1;
                this.angle    = interaction.prevEvent.angle;
                this.da       = this.angle - interaction.gesture.startAngle;
            }
            else {
                this.distance = touchDistance(pointerMoves, deltaSource);
                this.box      = touchBBox(pointerMoves);
                this.scale    = this.distance / interaction.gesture.startDistance;
                this.angle    = touchAngle(pointerMoves, interaction.gesture.prevAngle, deltaSource);

                this.ds = this.scale - interaction.gesture.prevScale;
                this.da = this.angle - interaction.gesture.prevAngle;
            }
        }

        if (starting) {
            this.timeStamp = interaction.downTime;
            this.dt        = 0;
            this.duration  = 0;
            this.speed     = 0;
            this.velocityX = 0;
            this.velocityY = 0;
        }
        else if (phase === 'inertiastart') {
            this.timeStamp = new Date().getTime();
            this.dt        = interaction.prevEvent.dt;
            this.duration  = interaction.prevEvent.duration;
            this.speed     = interaction.prevEvent.speed;
            this.velocityX = interaction.prevEvent.velocityX;
            this.velocityY = interaction.prevEvent.velocityY;
        }
        else {
            this.timeStamp = new Date().getTime();
            this.dt        = this.timeStamp - interaction.prevEvent.timeStamp;
            this.duration  = this.timeStamp - interaction.downTime;

            var dx, dy, dt;

            // Use natural event coordinates (without snapping/restricions)
            // subtract modifications from previous event if event given is
            // not a native event
            if (ending || event instanceof InteractEvent) {
                // change in time in seconds
                // use event sequence duration for end events
                // => average speed of the event sequence
                // (minimum dt of 1ms)
                dt = Math.max((ending? this.duration: this.dt) / 1000, 0.001);
                dx = this[sourceX] - interaction.prevEvent[sourceX];
                dy = this[sourceY] - interaction.prevEvent[sourceY];

                if (this.snap && this.snap.locked) {
                    dx -= this.snap.dx;
                    dy -= this.snap.dy;
                }

                if (this.restrict) {
                    dx -= this.restrict.dx;
                    dy -= this.restrict.dy;
                }

                if (interaction.prevEvent.snap && interaction.prevEvent.snap.locked) {
                    dx -= (interaction.prevEvent[sourceX] - interaction.prevEvent.snap.dx);
                    dy -= (interaction.prevEvent[sourceY] - interaction.prevEvent.snap.dy);
                }

                if (interaction.prevEvent.restrict) {
                    dx += interaction.prevEvent.restrict.dx;
                    dy += interaction.prevEvent.restrict.dy;
                }

                // speed and velocity in pixels per second
                this.speed = hypot(dx, dy) / dt;
                this.velocityX = dx / dt;
                this.velocityY = dy / dt;
            }
            // if normal move event, use previous user event coords
            else {
                this.speed = interaction.pointerDelta[deltaSource + 'Speed'];
                this.velocityX = interaction.pointerDelta[deltaSource + 'VX'];
                this.velocityY = interaction.pointerDelta[deltaSource + 'VY'];
            }
        }

        if ((ending || phase === 'inertiastart')
            && interaction.prevEvent.speed > 600 && this.timeStamp - interaction.prevEvent.timeStamp < 150) {

            var angle = 180 * Math.atan2(interaction.prevEvent.velocityY, interaction.prevEvent.velocityX) / Math.PI,
                overlap = 22.5;

            if (angle < 0) {
                angle += 360;
            }

            var left = 135 - overlap <= angle && angle < 225 + overlap,
                up   = 225 - overlap <= angle && angle < 315 + overlap,

                right = !left && (315 - overlap <= angle || angle <  45 + overlap),
                down  = !up   &&   45 - overlap <= angle && angle < 135 + overlap;

            this.swipe = {
                up   : up,
                down : down,
                left : left,
                right: right,
                angle: angle,
                speed: interaction.prevEvent.speed,
                velocity: {
                    x: interaction.prevEvent.velocityX,
                    y: interaction.prevEvent.velocityY
                }
            };
        }
    }

    InteractEvent.prototype = {
        preventDefault: blank,
        stopImmediatePropagation: function () {
            this.immediatePropagationStopped = this.propagationStopped = true;
        },
        stopPropagation: function () {
            this.propagationStopped = true;
        }
    };

    function preventOriginalDefault () {
        this.originalEvent.preventDefault();
    }

    function defaultActionChecker (event, interaction) {
        var rect = this.getRect(),
            right,
            bottom,
            action = null,
            page = getPageXY(interaction.pointerMoves[0]),
            options = this.options;

        if (!rect) { return null; }

        if (actionIsEnabled.resize && options.resizable) {
            right  = options.resizeAxis !== 'y' && page.x > (rect.right  - margin);
            bottom = options.resizeAxis !== 'x' && page.y > (rect.bottom - margin);
        }

        interaction.resizeAxes = (right?'x': '') + (bottom?'y': '');

        action = (interaction.resizeAxes)?
            'resize' + interaction.resizeAxes:
            actionIsEnabled.drag && options.draggable?
                'drag':
                null;

        if (actionIsEnabled.gesture
            && interaction.pointerIds.length >=2
            && !(interaction.dragging || interaction.resizing)) {
            action = 'gesture';
        }

        return action;
    }

    // Check if action is enabled globally and the current target supports it
    // If so, return the validated action. Otherwise, return null
    function validateAction (action, interactable) {
        if (!isString(action)) { return null; }

        var actionType = action.search('resize') !== -1? 'resize': action,
            options = interactable;

        if ((  (actionType  === 'resize'   && options.resizable )
            || (action      === 'drag'     && options.draggable  )
            || (action      === 'gesture'  && options.gesturable))
            && actionIsEnabled[actionType]) {

            if (action === 'resize' || action === 'resizeyx') {
                action = 'resizexy';
            }

            return action;
        }
        return null;
    }

    var listeners = {},
        interactionListeners = [
            'dragStart', 'dragMove', 'resizeStart', 'resizeMove', 'gestureStart', 'gestureMove',
            'pointerOver', 'pointerOut', 'pointerHover', 'selectorDown', 'pointerDown', 'pointerMove', 'pointerUp',
            'addPointer', 'removePointer', 'recordPointers', 'recordTouches', 'collectTaps', 'fireTaps'
        ];

    for (var i = 0, len = interactionListeners.length; i < len; i++) {
        var name = interactionListeners[i];

        listeners[name] = doOnInteraction(name);
    }

    // bound to the interactable context when a DOM event
    // listener is added to a selector interactable
    function delegateListener (event, useCapture) {
        var fakeEvent = {},
            delegated = delegatedEvents[event.type],
            element = event.target;

        useCapture = useCapture? true: false;

        // duplicate the event so that currentTarget can be changed
        for (var prop in event) {
            fakeEvent[prop] = event[prop];
        }

        fakeEvent.originalEvent = event;
        fakeEvent.preventDefault = preventOriginalDefault;

        // climb up document tree looking for selector matches
        while (element && element !== document) {
            for (var i = 0; i < delegated.selectors.length; i++) {
                var selector = delegated.selectors[i],
                    context = delegated.contexts[i];

                if (matchesSelector(element, selector)
                    && context === event.currentTarget
                    && nodeContains(context, element)) {

                    var listeners = delegated.listeners[i];

                    fakeEvent.currentTarget = element;

                    for (var j = 0; j < listeners.length; j++) {
                        if (listeners[j][1] !== useCapture) { continue; }

                        try {
                            listeners[j][0](fakeEvent);
                        }
                        catch (error) {
                            console.error('Error thrown from delegated listener: ' +
                                          '"' + selector + '" ' + event.type + ' ' +
                                          (listeners[j][0].name? listeners[j][0].name: ''));
                            console.log(error);
                        }
                    }
                }
            }

            element = element.parentNode;
        }
    }

    function delegateUseCapture (event) {
        return delegateListener.call(this, event, true);
    }

    interactables.indexOfElement = dropzones.indexOfElement = function indexOfElement (element, context) {
        for (var i = 0; i < this.length; i++) {
            var interactable = this[i];

            if ((interactable.selector === element
                && (interactable._context === (context || document)))

                || (!interactable.selector && interactable._element === element)) {

                return i;
            }
        }
        return -1;
    };

    interactables.get = dropzones.get = function interactableGet (element, options) {
        return this[this.indexOfElement(element, options && options.context)];
    };

    interactables.forEachSelector = function (callback) {
        for (var i = 0; i < this.length; i++) {
            var interactable = this[i];

            if (!interactable.selector) {
                continue;
            }

            var ret = callback(interactable, interactable.selector, interactable._context, i, this);

            if (ret !== undefined) {
                return ret;
            }
        }
    };

    /*\
     * interact
     [ method ]
     *
     * The methods of this variable can be used to set elements as
     * interactables and also to change various default settings.
     *
     * Calling it as a function and passing an element or a valid CSS selector
     * string returns an Interactable object which has various methods to
     * configure it.
     *
     - element (Element | string) The HTML or SVG Element to interact with or CSS selector
     = (object) An @Interactable
     *
     > Usage
     | interact(document.getElementById('draggable')).draggable(true);
     |
     | var rectables = interact('rect');
     | rectables
     |     .gesturable(true)
     |     .on('gesturemove', function (event) {
     |         // something cool...
     |     })
     |     .autoScroll(true);
    \*/
    function interact (element, options) {
        return interactables.get(element, options) || new Interactable(element, options);
    }

    // A class for easy inheritance and setting of an Interactable's options
    function IOptions (options) {
        for (var option in defaultOptions) {
            if (options.hasOwnProperty(option)
                && typeof options[option] === typeof defaultOptions[option]) {
                this[option] = options[option];
            }
        }
    }

    IOptions.prototype = defaultOptions;

    /*\
     * Interactable
     [ property ]
     **
     * Object type returned by @interact
    \*/
    function Interactable (element, options) {
        this._element = element;
        this._iEvents = this._iEvents || {};

        if (isString(element)) {
            // if the selector is invalid,
            // an exception will be raised
            document.querySelector(element);

            this.selector = element;

            if (options && options.context
                && (window.Node
                    ? options.context instanceof window.Node
                    : (isElement(options.context) || options.context === document))) {
                this._context = options.context;
            }
        }
        else if (isElement(element)) {
            if (PointerEvent) {
                events.add(this, pEventTypes.down, listeners.pointerDown );
                events.add(this, pEventTypes.move, listeners.pointerHover);
            }
            else {
                events.add(this, 'mousedown' , listeners.pointerDown );
                events.add(this, 'mousemove' , listeners.pointerHover);
                events.add(this, 'touchstart', listeners.pointerDown );
                events.add(this, 'touchmove' , listeners.pointerHover);
            }
        }

        interactables.push(this);

        this.set(options);
    }

    Interactable.prototype = {
        setOnEvents: function (action, phases) {
            if (action === 'drop') {
                var drop            = phases.ondrop             || phases.onDrop            || phases.drop,
                    dropactivate    = phases.ondropactivate     || phases.onDropActivate    || phases.dropactivate
                                   || phases.onactivate         || phases.onActivate        || phases.activate,
                    dropdeactivate  = phases.ondropdeactivate   || phases.onDropDeactivate  || phases.dropdeactivate
                                   || phases.ondeactivate       || phases.onDeactivate      || phases.deactivate,
                    dragenter       = phases.ondragenter        || phases.onDropEnter       || phases.dragenter
                                   || phases.onenter            || phases.onEnter           || phases.enter,
                    dragleave       = phases.ondragleave        || phases.onDropLeave       || phases.dragleave
                                   || phases.onleave            || phases.onLeave           || phases.leave,
                    dropmove        = phases.ondropmove         || phases.onDropMove        || phases.dropmove
                                   || phases.onmove             || phases.onMove            || phases.move;

                if (isFunction(drop)          ) { this.ondrop           = drop          ; }
                if (isFunction(dropactivate)  ) { this.ondropactivate   = dropactivate  ; }
                if (isFunction(dropdeactivate)) { this.ondropdeactivate = dropdeactivate; }
                if (isFunction(dragenter)     ) { this.ondragenter      = dragenter     ; }
                if (isFunction(dragleave)     ) { this.ondragleave      = dragleave     ; }
                if (isFunction(dropmove)      ) { this.ondropmove       = dropmove      ; }
            }
            else {
                var start        = phases.onstart        || phases.onStart        || phases.start,
                    move         = phases.onmove         || phases.onMove         || phases.move,
                    end          = phases.onend          || phases.onEnd          || phases.end,
                    inertiastart = phases.oninertiastart || phases.onInertiaStart || phases.inertiastart;

                action = 'on' + action;

                if (isFunction(start)       ) { this[action + 'start'         ] = start         ; }
                if (isFunction(move)        ) { this[action + 'move'          ] = move          ; }
                if (isFunction(end)         ) { this[action + 'end'           ] = end           ; }
                if (isFunction(inertiastart)) { this[action + 'inertiastart'  ] = inertiastart  ; }
            }

            return this;
        },

        /*\
         * Interactable.draggable
         [ method ]
         *
         * Gets or sets whether drag actions can be performed on the
         * Interactable
         *
         = (boolean) Indicates if this can be the target of drag events
         | var isDraggable = interact('ul li').draggable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on drag events (object makes the Interactable draggable)
         = (object) This Interactable
         | interact(element).draggable({
         |     onstart: function (event) {},
         |     onmove : function (event) {},
         |     onend  : function (event) {},
         |
         |     // the axis in which the first movement must be
         |     // for the drag sequence to start
         |     // 'xy' by default - any direction
         |     axis: 'x' || 'y' || 'xy'
         | });
        \*/
        draggable: function (options) {
            if (isObject(options)) {
                this.options.draggable = true;
                this.setOnEvents('drag', options);

                if (/^x$|^y$|^xy$/.test(options.axis)) {
                    this.options.dragAxis = options.axis;
                }
                else if (options.axis === null) {
                    delete this.options.dragAxis;
                }

                return this;
            }

            if (isBool(options)) {
                this.options.draggable = options;

                return this;
            }

            if (options === null) {
                delete this.options.draggable;

                return this;
            }

            return this.options.draggable;
        },

        /*\
         * Interactable.dropzone
         [ method ]
         *
         * Returns or sets whether elements can be dropped onto this
         * Interactable to trigger drop events
         *
         * Dropzones can recieve the following events:
         *  - `dragactivate` and `dragdeactivate` when an acceptable drag starts and ends
         *  - `dragenter` and `dragleave` when a draggable enters and leaves the dropzone
         *  - `drop` when a draggable is dropped into this dropzone
         *
         *  Use the `accept` option to allow only elements that match the given CSS selector or element.
         *
         *  Use the `overlap` option to set how drops are checked for. The allowed values are:
         *   - `'pointer'`, the pointer must be over the dropzone (default)
         *   - `'center'`, the draggable element's center must be over the dropzone
         *   - a number from 0-1 which is the `(intersetion area) / (draggable area)`.
         *       e.g. `0.5` for drop to happen when half of the area of the
         *       draggable is over the dropzone
         *
         - options (boolean | object | null) #optional The new value to be set.
         | interact('.drop').dropzone({
         |   accept: '.can-drop' || document.getElementById('single-drop'),
         |   overlap: 'pointer' || 'center' || zeroToOne
         | }
         = (boolean | object) The current setting or this Interactable
        \*/
        dropzone: function (options) {
            if (isObject(options)) {
                this.options.dropzone = true;
                this.setOnEvents('drop', options);
                this.accept(options.accept);

                if (/^(pointer|center)$/.test(options.overlap)) {
                    this.options.dropOverlap = options.overlap;
                }
                else if (isNumber(options.overlap)) {
                    this.options.dropOverlap = Math.max(Math.min(1, options.overlap), 0);
                }

                this._dropElements = this.selector? null: [this._element];
                dropzones.push(this);

                return this;
            }

            if (isBool(options)) {
                if (options) {
                    this._dropElements = this.selector? null: [this._element];
                    dropzones.push(this);
                }
                else {
                    var index = indexOf(dropzones, this);

                    if (index !== -1) {
                        dropzones.splice(index, 1);
                    }
                }

                this.options.dropzone = options;

                return this;
            }

            if (options === null) {
                delete this.options.dropzone;

                return this;
            }

            return this.options.dropzone;
        },

        /*\
         * Interactable.dropCheck
         [ method ]
         *
         * The default function to determine if a dragend event occured over
         * this Interactable's element. Can be overridden using
         * @Interactable.dropChecker.
         *
         - event (MouseEvent | TouchEvent) The event that ends a drag
         = (boolean) whether the pointer was over this Interactable
        \*/
        dropCheck: function (event, draggable, draggableElement, rect) {
            if (!(rect = rect || this.getRect())) {
                return false;
            }

            var dropOverlap = this.options.dropOverlap;

            if (dropOverlap === 'pointer') {
                var page = getPageXY(event),
                    origin = getOriginXY(draggable, draggableElement),
                    horizontal,
                    vertical;

                page.x += origin.x;
                page.y += origin.y;

                horizontal = (page.x > rect.left) && (page.x < rect.right);
                vertical   = (page.y > rect.top ) && (page.y < rect.bottom);

                return horizontal && vertical;
            }

            var dragRect = draggable.getRect(draggableElement);

            if (dropOverlap === 'center') {
                var cx = dragRect.left + dragRect.width  / 2,
                    cy = dragRect.top  + dragRect.height / 2;

                return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
            }

            if (isNumber(dropOverlap)) {
                var overlapArea  = (Math.max(0, Math.min(rect.right , dragRect.right ) - Math.max(rect.left, dragRect.left))
                                  * Math.max(0, Math.min(rect.bottom, dragRect.bottom) - Math.max(rect.top , dragRect.top ))),
                    overlapRatio = overlapArea / (dragRect.width * dragRect.height);

                return overlapRatio >= dropOverlap;
            }
        },

        /*\
         * Interactable.dropChecker
         [ method ]
         *
         * Gets or sets the function used to check if a dragged element is
         * over this Interactable. See @Interactable.dropCheck.
         *
         - checker (function) #optional
         * The checker is a function which takes a mouseUp/touchEnd event as a
         * parameter and returns true or false to indicate if the the current
         * draggable can be dropped into this Interactable
         *
         = (Function | Interactable) The checker function or this Interactable
        \*/
        dropChecker: function (newValue) {
            if (isFunction(newValue)) {
                this.dropCheck = newValue;

                return this;
            }
            return this.dropCheck;
        },

        /*\
         * Interactable.accept
         [ method ]
         *
         * Gets or sets the Element or CSS selector match that this
         * Interactable accepts if it is a dropzone.
         *
         - newValue (Element | string | null) #optional
         * If it is an Element, then only that element can be dropped into this dropzone.
         * If it is a string, the element being dragged must match it as a selector.
         * If it is null, the accept options is cleared - it accepts any element.
         *
         = (string | Element | null | Interactable) The current accept option if given `undefined` or this Interactable
        \*/
        accept: function (newValue) {
            if (isElement(newValue)) {
                this.options.accept = newValue;

                return this;
            }

            if (isString(newValue)) {
                // test if it is a valid CSS selector
                document.querySelector(newValue);
                this.options.accept = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.accept;

                return this;
            }

            return this.options.accept;
        },

        /*\
         * Interactable.resizable
         [ method ]
         *
         * Gets or sets whether resize actions can be performed on the
         * Interactable
         *
         = (boolean) Indicates if this can be the target of resize elements
         | var isResizeable = interact('input[type=text]').resizable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on resize events (object makes the Interactable resizable)
         = (object) This Interactable
         | interact(element).resizable({
         |     onstart: function (event) {},
         |     onmove : function (event) {},
         |     onend  : function (event) {},
         |
         |     axis   : 'x' || 'y' || 'xy' // default is 'xy'
         | });
        \*/
        resizable: function (options) {
            if (isObject(options)) {
                this.options.resizable = true;
                this.setOnEvents('resize', options);

                if (/^x$|^y$|^xy$/.test(options.axis)) {
                    this.options.resizeAxis = options.axis;
                }
                else if (options.axis === null) {
                    this.options.resizeAxis = defaultOptions.resizeAxis;
                }

                return this;
            }
            if (isBool(options)) {
                this.options.resizable = options;

                return this;
            }
            return this.options.resizable;
        },

        // misspelled alias
        resizeable: blank,

        /*\
         * Interactable.squareResize
         [ method ]
         *
         * Gets or sets whether resizing is forced 1:1 aspect
         *
         = (boolean) Current setting
         *
         * or
         *
         - newValue (boolean) #optional
         = (object) this Interactable
        \*/
        squareResize: function (newValue) {
            if (isBool(newValue)) {
                this.options.squareResize = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.squareResize;

                return this;
            }

            return this.options.squareResize;
        },

        /*\
         * Interactable.gesturable
         [ method ]
         *
         * Gets or sets whether multitouch gestures can be performed on the
         * Interactable's element
         *
         = (boolean) Indicates if this can be the target of gesture events
         | var isGestureable = interact(element).gesturable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on gesture events (makes the Interactable gesturable)
         = (object) this Interactable
         | interact(element).gesturable({
         |     onmove: function (event) {}
         | });
        \*/
        gesturable: function (options) {
            if (isObject(options)) {
                this.options.gesturable = true;
                this.setOnEvents('gesture', options);

                return this;
            }

            if (isBool(options)) {
                this.options.gesturable = options;

                return this;
            }

            if (options === null) {
                delete this.options.gesturable;

                return this;
            }

            return this.options.gesturable;
        },

        // misspelled alias
        gestureable: blank,

        /*\
         * Interactable.autoScroll
         [ method ]
         *
         * Returns or sets whether or not any actions near the edges of the
         * window/container trigger autoScroll for this Interactable
         *
         = (boolean | object)
         * `false` if autoScroll is disabled; object with autoScroll properties
         * if autoScroll is enabled
         *
         * or
         *
         - options (object | boolean | null) #optional
         * options can be:
         * - an object with margin, distance and interval properties,
         * - true or false to enable or disable autoScroll or
         * - null to use default settings
         = (Interactable) this Interactable
        \*/
        autoScroll: function (options) {
            var defaults = defaultOptions.autoScroll;

            if (isObject(options)) {
                var autoScroll = this.options.autoScroll;

                if (autoScroll === defaults) {
                   autoScroll = this.options.autoScroll = {
                       margin   : defaults.margin,
                       distance : defaults.distance,
                       interval : defaults.interval,
                       container: defaults.container
                   };
                }

                autoScroll.margin = this.validateSetting('autoScroll', 'margin', options.margin);
                autoScroll.speed  = this.validateSetting('autoScroll', 'speed' , options.speed);

                autoScroll.container =
                    (isElement(options.container) || options.container instanceof window.Window
                     ? options.container
                     : defaults.container);


                this.options.autoScrollEnabled = true;
                this.options.autoScroll = autoScroll;

                return this;
            }

            if (isBool(options)) {
                this.options.autoScrollEnabled = options;

                return this;
            }

            if (options === null) {
                delete this.options.autoScrollEnabled;
                delete this.options.autoScroll;

                return this;
            }

            return (this.options.autoScrollEnabled
                ? this.options.autoScroll
                : false);
        },

        /*\
         * Interactable.snap
         [ method ]
         **
         * Returns or sets if and how action coordinates are snapped. By
         * default, snapping is relative to the pointer coordinates. You can
         * change this by setting the
         * [`elementOrigin`](https://github.com/taye/interact.js/pull/72).
         **
         = (boolean | object) `false` if snap is disabled; object with snap properties if snap is enabled
         **
         * or
         **
         - options (object | boolean | null) #optional
         = (Interactable) this Interactable
         > Usage
         | interact('.handle').snap({
         |     mode        : 'grid',                // event coords should snap to the corners of a grid
         |     range       : Infinity,              // the effective distance of snap ponts
         |     grid        : { x: 100, y: 100 },    // the x and y spacing of the grid points
         |     gridOffset  : { x:   0, y:   0 },    // the offset of the grid points
         | });
         |
         | interact('.handle').snap({
         |     mode        : 'anchor',              // snap to specified points
         |     anchors     : [
         |         { x: 100, y: 100, range: 25 },   // a point with x, y and a specific range
         |         { x: 200, y: 200 }               // a point with x and y. it uses the default range
         |     ]
         | });
         |
         | interact(document.querySelector('#thing')).snap({
         |     mode : 'path',
         |     paths: [
         |         {            // snap to points on these x and y axes
         |             x: 100,
         |             y: 100,
         |             range: 25
         |         },
         |         // give this function the x and y page coords and snap to the object returned
         |         function (x, y) {
         |             return {
         |                 x: x,
         |                 y: (75 + 50 * Math.sin(x * 0.04)),
         |                 range: 40
         |             };
         |         }]
         | })
         |
         | interact(element).snap({
         |     // do not snap during normal movement.
         |     // Instead, trigger only one snapped move event
         |     // immediately before the end event.
         |     endOnly: true,
         |
         |     // https://github.com/taye/interact.js/pull/72#issue-41813493
         |     elementOrigin: { x: 0, y: 0 }
         | });
        \*/
        snap: function (options) {
            var defaults = defaultOptions.snap;

            if (isObject(options)) {
                var snap = this.options.snap;

                if (snap === defaults) {
                   snap = {};
                }

                snap.mode          = this.validateSetting('snap', 'mode'         , options.mode);
                snap.endOnly       = this.validateSetting('snap', 'endOnly'      , options.endOnly);
                snap.actions       = this.validateSetting('snap', 'actions'      , options.actions);
                snap.range         = this.validateSetting('snap', 'range'        , options.range);
                snap.paths         = this.validateSetting('snap', 'paths'        , options.paths);
                snap.grid          = this.validateSetting('snap', 'grid'         , options.grid);
                snap.gridOffset    = this.validateSetting('snap', 'gridOffset'   , options.gridOffset);
                snap.anchors       = this.validateSetting('snap', 'anchors'      , options.anchors);
                snap.elementOrigin = this.validateSetting('snap', 'elementOrigin', options.elementOrigin);

                this.options.snapEnabled = true;
                this.options.snap = snap;

                return this;
            }

            if (isBool(options)) {
                this.options.snapEnabled = options;

                return this;
            }

            if (options === null) {
                delete this.options.snapEnabled;
                delete this.options.snap;

                return this;
            }

            return (this.options.snapEnabled
                ? this.options.snap
                : false);
        },

        /*\
         * Interactable.inertia
         [ method ]
         **
         * Returns or sets if and how events continue to run after the pointer is released
         **
         = (boolean | object) `false` if inertia is disabled; `object` with inertia properties if inertia is enabled
         **
         * or
         **
         - options (object | boolean | null) #optional
         = (Interactable) this Interactable
         > Usage
         | // enable and use default settings
         | interact(element).inertia(true);
         |
         | // enable and use custom settings
         | interact(element).inertia({
         |     // value greater than 0
         |     // high values slow the object down more quickly
         |     resistance     : 16,
         |
         |     // the minimum launch speed (pixels per second) that results in inertiastart
         |     minSpeed       : 200,
         |
         |     // inertia will stop when the object slows down to this speed
         |     endSpeed       : 20,
         |
         |     // boolean; should the jump when resuming from inertia be ignored in event.dx/dy
         |     zeroResumeDelta: false,
         |
         |     // if snap/restrict are set to be endOnly and inertia is enabled, releasing
         |     // the pointer without triggering inertia will animate from the release
         |     // point to the snaped/restricted point in the given amount of time (ms)
         |     smoothEndDuration: 300,
         |
         |     // an array of action types that can have inertia (no gesture)
         |     actions        : ['drag', 'resize']
         | });
         |
         | // reset custom settings and use all defaults
         | interact(element).inertia(null);
        \*/
        inertia: function (options) {
            var defaults = defaultOptions.inertia;

            if (isObject(options)) {
                var inertia = this.options.inertia;

                if (inertia === defaults) {
                   inertia = this.options.inertia = {
                       resistance       : defaults.resistance,
                       minSpeed         : defaults.minSpeed,
                       endSpeed         : defaults.endSpeed,
                       actions          : defaults.actions,
                       zeroResumeDelta  : defaults.zeroResumeDelta,
                       smoothEndDuration: defaults.smoothEndDuration
                   };
                }

                inertia.resistance        = this.validateSetting('inertia', 'resistance'       , options.resistance);
                inertia.minSpeed          = this.validateSetting('inertia', 'minSpeed'         , options.minSpeed);
                inertia.endSpeed          = this.validateSetting('inertia', 'endSpeed'         , options.endSpeed);
                inertia.actions           = this.validateSetting('inertia', 'actions'          , options.actions);
                inertia.zeroResumeDelta   = this.validateSetting('inertia', 'zeroResumeDelta'  , options.zeroResumeDelta);
                inertia.smoothEndDuration = this.validateSetting('inertia', 'smoothEndDuration', options.smoothEndDuration);

                this.options.inertiaEnabled = true;
                this.options.inertia = inertia;

                return this;
            }

            if (isBool(options)) {
                this.options.inertiaEnabled = options;

                return this;
            }

            if (options === null) {
                delete this.options.inertiaEnabled;
                delete this.options.inertia;

                return this;
            }

            return (this.options.inertiaEnabled
                ? this.options.inertia
                : false);
        },

        getAction: function (event, interaction) {
            var action = this.defaultActionChecker(event, interaction);

            if (this.options.actionChecker) {
                action = this.options.actionChecker(event, action, interaction, this);
            }

            return action;
        },

        defaultActionChecker: defaultActionChecker,

        /*\
         * Interactable.actionChecker
         [ method ]
         *
         * Gets or sets the function used to check action to be performed on
         * pointerDown
         *
         - checker (function | null) #optional A function which takes a pointer event, defaultAction string and an interactable as parameters and returns 'drag' 'resize[axes]' or 'gesture' or null.
         = (Function | Interactable) The checker function or this Interactable
        \*/
        actionChecker: function (newValue) {
            if (isFunction(newValue)) {
                this.options.actionChecker = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.actionChecker;

                return this;
            }

            return this.options.actionChecker;
        },

        /*\
         * Interactable.getRect
         [ method ]
         *
         * The default function to get an Interactables bounding rect. Can be
         * overridden using @Interactable.rectChecker.
         *
         - element (Element) #optional The element to measure. Meant to be used for selector Interactables which don't have a specific element.
         = (object) The object's bounding rectangle.
         o {
         o     top   : 0,
         o     left  : 0,
         o     bottom: 0,
         o     right : 0,
         o     width : 0,
         o     height: 0
         o }
        \*/
        getRect: function rectCheck (element) {
            element = element || this._element;

            if (this.selector && !(isElement(element))) {
                element = this._context.querySelector(this.selector);
            }

            return getElementRect(element);
        },

        /*\
         * Interactable.rectChecker
         [ method ]
         *
         * Returns or sets the function used to calculate the interactable's
         * element's rectangle
         *
         - checker (function) #optional A function which returns this Interactable's bounding rectangle. See @Interactable.getRect
         = (function | object) The checker function or this Interactable
        \*/
        rectChecker: function (newValue) {
            if (isFunction(newValue)) {
                this.getRect = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.getRect;

                return this;
            }

            return this.getRect;
        },

        /*\
         * Interactable.styleCursor
         [ method ]
         *
         * Returns or sets whether the action that would be performed when the
         * mouse on the element are checked on `mousemove` so that the cursor
         * may be styled appropriately
         *
         - newValue (boolean) #optional
         = (boolean | Interactable) The current setting or this Interactable
        \*/
        styleCursor: function (newValue) {
            if (isBool(newValue)) {
                this.options.styleCursor = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.styleCursor;

                return this;
            }

            return this.options.styleCursor;
        },

        /*\
         * Interactable.preventDefault
         [ method ]
         *
         * Returns or sets whether to prevent the browser's default behaviour
         * in response to pointer events. Can be set to
         *  - `true` to always prevent
         *  - `false` to never prevent
         *  - `'auto'` to allow interact.js to try to guess what would be best
         *  - `null` to set to the default ('auto')
         *
         - newValue (boolean | string | null) #optional `true`, `false` or `'auto'`
         = (boolean | string | Interactable) The current setting or this Interactable
        \*/
        preventDefault: function (newValue) {
            if (isBool(newValue) || newValue === 'auto') {
                this.options.preventDefault = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.preventDefault;

                return this;
            }

            return this.options.preventDefault;
        },

        /*\
         * Interactable.origin
         [ method ]
         *
         * Gets or sets the origin of the Interactable's element.  The x and y
         * of the origin will be subtracted from action event coordinates.
         *
         - origin (object) #optional An object with x and y properties which are numbers
         * OR
         - origin (Element) #optional An HTML or SVG Element whose rect will be used
         **
         = (object) The current origin or this Interactable
        \*/
        origin: function (newValue) {
            if (isObject(newValue) || /^parent$|^self$/.test(newValue)) {
                this.options.origin = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.origin;

                return this;
            }

            return this.options.origin;
        },

        /*\
         * Interactable.deltaSource
         [ method ]
         *
         * Returns or sets the mouse coordinate types used to calculate the
         * movement of the pointer.
         *
         - source (string) #optional Use 'client' if you will be scrolling while interacting; Use 'page' if you want autoScroll to work
         = (string | object) The current deltaSource or this Interactable
        \*/
        deltaSource: function (newValue) {
            if (newValue === 'page' || newValue === 'client') {
                this.options.deltaSource = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.deltaSource;

                return this;
            }

            return this.options.deltaSource;
        },

        /*\
         * Interactable.restrict
         [ method ]
         **
         * Returns or sets the rectangles within which actions on this
         * interactable (after snap calculations) are restricted. By default,
         * restricting is relative to the pointer coordinates. You can change
         * this by setting the
         * [`elementRect`](https://github.com/taye/interact.js/pull/72).
         **
         - newValue (object) #optional an object with keys drag, resize, and/or gesture and rects or Elements as values
         = (object) The current restrictions object or this Interactable
         **
         | interact(element).restrict({
         |     // the rect will be `interact.getElementRect(element.parentNode)`
         |     drag: element.parentNode,
         |
         |     // x and y are relative to the the interactable's origin
         |     resize: { x: 100, y: 100, width: 200, height: 200 }
         | })
         |
         | interact('.draggable').restrict({
         |     // the rect will be the selected element's parent
         |     drag: 'parent',
         |
         |     // do not restrict during normal movement.
         |     // Instead, trigger only one restricted move event
         |     // immediately before the end event.
         |     endOnly: true,
         |
         |     // https://github.com/taye/interact.js/pull/72#issue-41813493
         |     elementRect: { top: 0, left: 0, bottom: 1, right: 1 }
         | });
        \*/
        restrict: function (newValue) {
            if (newValue === undefined) {
                return this.options.restrict;
            }

            if (isBool(newValue)) {
                defaultOptions.restrictEnabled = newValue;
            }
            else if (isObject(newValue)) {
                var newRestrictions = {};

                if (isObject(newValue.drag) || /^parent$|^self$/.test(newValue.drag)) {
                    newRestrictions.drag = newValue.drag;
                }
                if (isObject(newValue.resize) || /^parent$|^self$/.test(newValue.resize)) {
                    newRestrictions.resize = newValue.resize;
                }
                if (isObject(newValue.gesture) || /^parent$|^self$/.test(newValue.gesture)) {
                    newRestrictions.gesture = newValue.gesture;
                }

                if (isBool(newValue.endOnly)) {
                    newRestrictions.endOnly = newValue.endOnly;
                }

                if (isObject(newValue.elementRect)) {
                    newRestrictions.elementRect = newValue.elementRect;
                }

                this.options.restrictEnabled = true;
                this.options.restrict = newRestrictions;
            }
            else if (newValue === null) {
               delete this.options.restrict;
               delete this.options.restrictEnabled;
            }

            return this;
        },

        /*\
         * Interactable.context
         [ method ]
         *
         * Get's the selector context Node of the Interactable. The default is `window.document`.
         *
         = (Node) The context Node of this Interactable
         **
        \*/
        context: function () {
            return this._context;
        },

        _context: document,

        /*\
         * Interactable.ignoreFrom
         [ method ]
         *
         * If the target of the `mousedown`, `pointerdown` or `touchstart`
         * event or any of it's parents match the given CSS selector or
         * Element, no drag/resize/gesture is started.
         *
         - newValue (string | Element | null) #optional a CSS selector string, an Element or `null` to not ignore any elements
         = (string | Element | object) The current ignoreFrom value or this Interactable
         **
         | interact(element, { ignoreFrom: document.getElementById('no-action') });
         | // or
         | interact(element).ignoreFrom('input, textarea, a');
        \*/
        ignoreFrom: function (newValue) {
            if (isString(newValue)) {     // CSS selector to match event.target
                document.querySelector(newValue);   // test the selector
                this.options.ignoreFrom = newValue;
                return this;
            }

            if (isElement(newValue)) {              // specific element
                this.options.ignoreFrom = newValue;
                return this;
            }

            if (newValue === null) {
                delete this.options.ignoreFrom;
                return this;
            }

            return this.options.ignoreFrom;
        },

        /*\
         * Interactable.allowFrom
         [ method ]
         *
         * A drag/resize/gesture is started only If the target of the
         * `mousedown`, `pointerdown` or `touchstart` event or any of it's
         * parents match the given CSS selector or Element.
         *
         - newValue (string | Element | null) #optional a CSS selector string, an Element or `null` to allow from any element
         = (string | Element | object) The current allowFrom value or this Interactable
         **
         | interact(element, { allowFrom: document.getElementById('drag-handle') });
         | // or
         | interact(element).allowFrom('.handle');
        \*/
        allowFrom: function (newValue) {
            if (isString(newValue)) {     // CSS selector to match event.target
                document.querySelector(newValue);   // test the selector
                this.options.allowFrom = newValue;
                return this;
            }

            if (isElement(newValue)) {              // specific element
                this.options.allowFrom = newValue;
                return this;
            }

            if (newValue === null) {
                delete this.options.allowFrom;
                return this;
            }

            return this.options.allowFrom;
        },

        /*\
         * Interactable.validateSetting
         [ method ]
         *
         - context (string) eg. 'snap', 'autoScroll'
         - option (string) The name of the value being set
         - value (any type) The value being validated
         *
         = (typeof value) A valid value for the give context-option pair
         * - null if defaultOptions[context][value] is undefined
         * - value if it is the same type as defaultOptions[context][value],
         * - this.options[context][value] if it is the same type as defaultOptions[context][value],
         * - or defaultOptions[context][value]
        \*/
        validateSetting: function (context, option, value) {
            var defaults = defaultOptions[context],
                current = this.options[context];

            if (defaults !== undefined && defaults[option] !== undefined) {
                if ('objectTypes' in defaults && defaults.objectTypes.test(option)) {
                    if (isObject(value)) { return value; }
                    else {
                        return (option in current && isObject(current[option])
                            ? current [option]
                            : defaults[option]);
                    }
                }

                if ('arrayTypes' in defaults && defaults.arrayTypes.test(option)) {
                    if (isArray(value)) { return value; }
                    else {
                        return (option in current && isArray(current[option])
                            ? current[option]
                            : defaults[option]);
                    }
                }

                if ('stringTypes' in defaults && defaults.stringTypes.test(option)) {
                    if (isString(value)) { return value; }
                    else {
                        return (option in current && isString(current[option])
                            ? current[option]
                            : defaults[option]);
                    }
                }

                if ('numberTypes' in defaults && defaults.numberTypes.test(option)) {
                    if (isNumber(value)) { return value; }
                    else {
                        return (option in current && isNumber(current[option])
                            ? current[option]
                            : defaults[option]);
                    }
                }

                if ('boolTypes' in defaults && defaults.boolTypes.test(option)) {
                    if (isBool(value)) { return value; }
                    else {
                        return (option in current && isBool(current[option])
                            ? current[option]
                            : defaults[option]);
                    }
                }

                if ('elementTypes' in defaults && defaults.elementTypes.test(option)) {
                    if (isElement(value)) { return value; }
                    else {
                        return (option in current && isElement(current[option])
                            ? current[option]
                            : defaults[option]);
                    }
                }
            }

            return null;
        },

        /*\
         * Interactable.element
         [ method ]
         *
         * If this is not a selector Interactable, it returns the element this
         * interactable represents
         *
         = (Element) HTML / SVG Element
        \*/
        element: function () {
            return this._element;
        },

        /*\
         * Interactable.fire
         [ method ]
         *
         * Calls listeners for the given InteractEvent type bound globablly
         * and directly to this Interactable
         *
         - iEvent (InteractEvent) The InteractEvent object to be fired on this Interactable
         = (Interactable) this Interactable
        \*/
        fire: function (iEvent) {
            if (!(iEvent && iEvent.type) || !contains(eventTypes, iEvent.type)) {
                return this;
            }

            var listeners,
                fireState = 0,
                i = 0,
                len,
                onEvent = 'on' + iEvent.type;

            // Try-catch and loop so an exception thrown from a listener
            // doesn't ruin everything for everyone
            while (fireState < 3) {
                try {
                    switch (fireState) {
                        // Interactable#on() listeners
                        case fireStates.directBind:
                            if (iEvent.type in this._iEvents) {
                            listeners = this._iEvents[iEvent.type];

                            for (len = listeners.length; i < len && !iEvent.immediatePropagationStopped; i++) {
                                listeners[i](iEvent);
                            }
                            break;
                        }

                        break;

                        // interactable.onevent listener
                        case fireStates.onevent:
                            if (isFunction(this[onEvent])) {
                            this[onEvent](iEvent);
                        }
                        break;

                        // interact.on() listeners
                        case fireStates.globalBind:
                            if (iEvent.type in globalEvents && (listeners = globalEvents[iEvent.type]))  {

                            for (len = listeners.length; i < len && !iEvent.immediatePropagationStopped; i++) {
                                listeners[i](iEvent);
                            }
                        }
                    }

                    if (iEvent.propagationStopped) {
                        break;
                    }

                    i = 0;
                    fireState++;
                }
                catch (error) {
                    console.error('Error thrown from ' + iEvent.type + ' listener');
                    console.error(error);
                    i++;

                    if (fireState === fireStates.onevent) {
                        fireState++;
                    }
                }
            }

            return this;
        },

        /*\
         * Interactable.on
         [ method ]
         *
         * Binds a listener for an InteractEvent or DOM event.
         *
         - eventType  (string)   The type of event to listen for
         - listener   (function) The function to be called on that event
         - useCapture (boolean) #optional useCapture flag for addEventListener
         = (object) This Interactable
        \*/
        on: function (eventType, listener, useCapture) {
            if (eventType === 'wheel') {
                eventType = wheelEvent;
            }

            // convert to boolean
            useCapture = useCapture? true: false;

            if (contains(eventTypes, eventType)) {
                // if this type of event was never bound to this Interactable
                if (!(eventType in this._iEvents)) {
                    this._iEvents[eventType] = [listener];
                }
                // if the event listener is not already bound for this type
                else if (!contains(this._iEvents[eventType], listener)) {
                    this._iEvents[eventType].push(listener);
                }
            }
            // delegated event for selector
            else if (this.selector) {
                if (!delegatedEvents[eventType]) {
                    delegatedEvents[eventType] = {
                        selectors: [],
                        contexts : [],
                        listeners: []
                    };

                    // add delegate listener functions
                    events.addToElement(this._context, eventType, delegateListener);
                    events.addToElement(this._context, eventType, delegateUseCapture, true);
                }

                var delegated = delegatedEvents[eventType],
                    index;

                for (index = delegated.selectors.length - 1; index >= 0; index--) {
                    if (delegated.selectors[index] === this.selector
                        && delegated.contexts[index] === this._context) {
                        break;
                    }
                }

                if (index === -1) {
                    index = delegated.selectors.length;

                    delegated.selectors.push(this.selector);
                    delegated.contexts .push(this._context);
                    delegated.listeners.push([]);
                }

                // keep listener and useCapture flag
                delegated.listeners[index].push([listener, useCapture]);
            }
            else {
                events.add(this, eventType, listener, useCapture);
            }

            return this;
        },

        /*\
         * Interactable.off
         [ method ]
         *
         * Removes an InteractEvent or DOM event listener
         *
         - eventType  (string)   The type of event that was listened for
         - listener   (function) The listener function to be removed
         - useCapture (boolean) #optional useCapture flag for removeEventListener
         = (object) This Interactable
        \*/
        off: function (eventType, listener, useCapture) {
            var eventList,
                index = -1;

            // convert to boolean
            useCapture = useCapture? true: false;

            if (eventType === 'wheel') {
                eventType = wheelEvent;
            }

            // if it is an action event type
            if (contains(eventTypes, eventType)) {
                eventList = this._iEvents[eventType];

                if (eventList && (index = indexOf(eventList, listener)) !== -1) {
                    this._iEvents[eventType].splice(index, 1);
                }
            }
            // delegated event
            else if (this.selector) {
                var delegated = delegatedEvents[eventType],
                    matchFound = false;

                if (!delegated) { return this; }

                // count from last index of delegated to 0
                for (index = delegated.selectors.length - 1; index >= 0; index--) {
                    // look for matching selector and context Node
                    if (delegated.selectors[index] === this.selector
                        && delegated.contexts[index] === this._context) {

                        var listeners = delegated.listeners[index];

                        // each item of the listeners array is an array: [function, useCaptureFlag]
                        for (var i = listeners.length - 1; i >= 0; i--) {
                            var fn = listeners[i][0],
                                useCap = listeners[i][1];

                            // check if the listener functions and useCapture flags match
                            if (fn === listener && useCap === useCapture) {
                                // remove the listener from the array of listeners
                                listeners.splice(i, 1);

                                // if all listeners for this interactable have been removed
                                // remove the interactable from the delegated arrays
                                if (!listeners.length) {
                                    delegated.selectors.splice(index, 1);
                                    delegated.contexts .splice(index, 1);
                                    delegated.listeners.splice(index, 1);

                                    // remove delegate function from context
                                    events.removeFromElement(this._context, eventType, delegateListener);
                                    events.removeFromElement(this._context, eventType, delegateUseCapture, true);

                                    // remove the arrays if they are empty
                                    if (!delegated.selectors.length) {
                                        delegatedEvents[eventType] = null;
                                    }
                                }

                                // only remove one listener
                                matchFound = true;
                                break;
                            }
                        }

                        if (matchFound) { break; }
                    }
                }
            }
            // remove listener from this Interatable's element
            else {
                events.remove(this, listener, useCapture);
            }

            return this;
        },

        /*\
         * Interactable.set
         [ method ]
         *
         * Reset the options of this Interactable
         - options (object) The new settings to apply
         = (object) This Interactablw
        \*/
        set: function (options) {
            if (!options || !isObject(options)) {
                options = {};
            }
            this.options = new IOptions(options);

            this.draggable ('draggable'  in options? options.draggable : this.options.draggable );
            this.dropzone  ('dropzone'   in options? options.dropzone  : this.options.dropzone  );
            this.resizable ('resizable'  in options? options.resizable : this.options.resizable );
            this.gesturable('gesturable' in options? options.gesturable: this.options.gesturable);

            var settings = [
                    'accept', 'actionChecker', 'allowFrom', 'autoScroll', 'deltaSource',
                    'dropChecker', 'ignoreFrom', 'inertia', 'origin', 'preventDefault',
                    'rectChecker', 'restrict', 'snap', 'styleCursor'
                ];

            for (var i = 0, len = settings.length; i < len; i++) {
                var setting = settings[i];

                if (setting in options) {
                    this[setting](options[setting]);
                }
            }

            return this;
        },

        /*\
         * Interactable.unset
         [ method ]
         *
         * Remove this interactable from the list of interactables and remove
         * it's drag, drop, resize and gesture capabilities
         *
         = (object) @interact
        \*/
        unset: function () {
            events.remove(this, 'all');

            if (!isString(this.selector)) {
                events.remove(this, 'all');
                if (this.options.styleCursor) {
                    this._element.style.cursor = '';
                }
            }
            else {
                // remove delegated events
                for (var type in delegatedEvents) {
                    var delegated = delegatedEvents[type];

                    for (var i = 0; i < delegated.selectors.length; i++) {
                        if (delegated.selectors[i] === this.selector
                            && delegated.contexts[i] === this._context) {

                            delegated.selectors.splice(i, 1);
                            delegated.contexts .splice(i, 1);
                            delegated.listeners.splice(i, 1);

                            // remove the arrays if they are empty
                            if (!delegated.selectors.length) {
                                delegatedEvents[type] = null;
                            }
                        }

                        events.removeFromElement(this._context, type, delegateListener);
                        events.removeFromElement(this._context, type, delegateUseCapture, true);

                        break;
                    }
                }
            }

            this.dropzone(false);

            interactables.splice(indexOf(interactables, this), 1);

            return interact;
        }
    };

    Interactable.prototype.gestureable = Interactable.prototype.gesturable;
    Interactable.prototype.resizeable = Interactable.prototype.resizable;

    /*\
     * interact.isSet
     [ method ]
     *
     * Check if an element has been set
     - element (Element) The Element being searched for
     = (boolean) Indicates if the element or CSS selector was previously passed to interact
    \*/
    interact.isSet = function(element, options) {
        return interactables.indexOfElement(element, options && options.context) !== -1;
    };

    /*\
     * interact.on
     [ method ]
     *
     * Adds a global listener for an InteractEvent or adds a DOM event to
     * `document`
     *
     - type       (string)   The type of event to listen for
     - listener   (function) The function to be called on that event
     - useCapture (boolean) #optional useCapture flag for addEventListener
     = (object) interact
    \*/
    interact.on = function (type, listener, useCapture) {
        // if it is an InteractEvent type, add listener to globalEvents
        if (contains(eventTypes, type)) {
            // if this type of event was never bound
            if (!globalEvents[type]) {
                globalEvents[type] = [listener];
            }

            // if the event listener is not already bound for this type
            else if (!contains(globalEvents[type], listener)) {

                globalEvents[type].push(listener);
            }
        }
        // If non InteratEvent type, addEventListener to document
        else {
            events.add(docTarget, type, listener, useCapture);
        }

        return interact;
    };

    /*\
     * interact.off
     [ method ]
     *
     * Removes a global InteractEvent listener or DOM event from `document`
     *
     - type       (string)   The type of event that was listened for
     - listener   (function) The listener function to be removed
     - useCapture (boolean) #optional useCapture flag for removeEventListener
     = (object) interact
    \*/
    interact.off = function (type, listener, useCapture) {
        if (!contains(eventTypes, type)) {
            events.remove(docTarget, type, listener, useCapture);
        }
        else {
            var index;

            if (type in globalEvents
                && (index = indexOf(globalEvents[type], listener)) !== -1) {
                globalEvents[type].splice(index, 1);
            }
        }

        return interact;
    };

    /*\
     * interact.simulate
     [ method ]
     *
     * Simulate pointer down to begin to interact with an interactable element
     - action       (string)  The action to be performed - drag, resize, etc.
     - element      (Element) The DOM Element to resize/drag
     - pointerEvent (object) #optional Pointer event whose pageX/Y coordinates will be the starting point of the interact drag/resize
     = (object) interact
    \*/
    interact.simulate = function (action, element, pointerEvent) {
        var event = {},
            clientRect;

        if (action === 'resize') {
            action = 'resizexy';
        }
        // return if the action is not recognised
        if (!/^(drag|resizexy|resizex|resizey)$/.test(action)) {
            return interact;
        }

        if (pointerEvent) {
            extend(event, pointerEvent);
        }
        else {
            clientRect = (element instanceof SVGElement)
                ? element.getBoundingClientRect()
                : clientRect = element.getClientRects()[0];

            if (action === 'drag') {
                event.pageX = clientRect.left + clientRect.width / 2;
                event.pageY = clientRect.top + clientRect.height / 2;
            }
            else {
                event.pageX = clientRect.right;
                event.pageY = clientRect.bottom;
            }
        }

        event.target = event.currentTarget = element;
        event.preventDefault = event.stopPropagation = blank;

        listeners.pointerDown(event, action);

        return interact;
    };

    /*\
     * interact.enableDragging
     [ method ]
     *
     * Returns or sets whether dragging is enabled for any Interactables
     *
     - newValue (boolean) #optional `true` to allow the action; `false` to disable action for all Interactables
     = (boolean | object) The current setting or interact
    \*/
    interact.enableDragging = function (newValue) {
        if (newValue !== null && newValue !== undefined) {
            actionIsEnabled.drag = newValue;

            return interact;
        }
        return actionIsEnabled.drag;
    };

    /*\
     * interact.enableResizing
     [ method ]
     *
     * Returns or sets whether resizing is enabled for any Interactables
     *
     - newValue (boolean) #optional `true` to allow the action; `false` to disable action for all Interactables
     = (boolean | object) The current setting or interact
    \*/
    interact.enableResizing = function (newValue) {
        if (newValue !== null && newValue !== undefined) {
            actionIsEnabled.resize = newValue;

            return interact;
        }
        return actionIsEnabled.resize;
    };

    /*\
     * interact.enableGesturing
     [ method ]
     *
     * Returns or sets whether gesturing is enabled for any Interactables
     *
     - newValue (boolean) #optional `true` to allow the action; `false` to disable action for all Interactables
     = (boolean | object) The current setting or interact
    \*/
    interact.enableGesturing = function (newValue) {
        if (newValue !== null && newValue !== undefined) {
            actionIsEnabled.gesture = newValue;

            return interact;
        }
        return actionIsEnabled.gesture;
    };

    interact.eventTypes = eventTypes;

    /*\
     * interact.debug
     [ method ]
     *
     * Returns debugging data
     = (object) An object with properties that outline the current state and expose internal functions and variables
    \*/
    interact.debug = function () {
        var interaction = interactions[0] || new Interaction();

        return {
            interactions          : interactions,
            target                : interaction.target,
            dragging              : interaction.dragging,
            resizing              : interaction.resizing,
            gesturing             : interaction.gesturing,
            prepared              : interaction.prepared,
            matches               : interaction.matches,

            prevCoords            : interaction.prevCoords,
            downCoords            : interaction.startCoords,

            pointerIds            : interaction.pointerIds,
            pointerMoves          : interaction.pointerMoves,
            addPointer            : listeners.addPointer,
            removePointer         : listeners.removePointer,
            recordPointers        : listeners.recordPointers,
            recordTouches         : listeners.recordTouches,

            snap                  : interaction.snapStatus,
            restrict              : interaction.restrictStatus,
            inertia               : interaction.inertiaStatus,

            downTime              : interaction.downTime,
            downEvent             : interaction.downEvent,
            prevEvent             : interaction.prevEvent,

            Interactable          : Interactable,
            IOptions              : IOptions,
            interactables         : interactables,
            dropzones             : dropzones,
            pointerIsDown         : interaction.pointerIsDown,
            defaultOptions        : defaultOptions,
            defaultActionChecker  : defaultActionChecker,

            actionCursors         : actionCursors,
            dragMove              : listeners.dragMove,
            resizeMove            : listeners.resizeMove,
            gestureMove           : listeners.gestureMove,
            pointerUp             : listeners.pointerUp,
            pointerDown           : listeners.pointerDown,
            pointerMove           : listeners.pointerMove,
            pointerHover          : listeners.pointerHover,

            events                : events,
            globalEvents          : globalEvents,
            delegatedEvents       : delegatedEvents
        };
    };

    // expose the functions used to caluclate multi-touch properties
    interact.getTouchAverage  = touchAverage;
    interact.getTouchBBox     = touchBBox;
    interact.getTouchDistance = touchDistance;
    interact.getTouchAngle    = touchAngle;

    interact.getElementRect   = getElementRect;

    /*\
     * interact.margin
     [ method ]
     *
     * Returns or sets the margin for autocheck resizing used in
     * @Interactable.getAction. That is the distance from the bottom and right
     * edges of an element clicking in which will start resizing
     *
     - newValue (number) #optional
     = (number | interact) The current margin value or interact
    \*/
    interact.margin = function (newvalue) {
        if (isNumber(newvalue)) {
            margin = newvalue;

            return interact;
        }
        return margin;
    };

    /*\
     * interact.styleCursor
     [ styleCursor ]
     *
     * Returns or sets whether the cursor style of the document is changed
     * depending on what action is being performed
     *
     - newValue (boolean) #optional
     = (boolean | interact) The current setting of interact
    \*/
    interact.styleCursor = function (newValue) {
        if (isBool(newValue)) {
            defaultOptions.styleCursor = newValue;

            return interact;
        }
        return defaultOptions.styleCursor;
    };

    /*\
     * interact.autoScroll
     [ method ]
     *
     * Returns or sets whether or not actions near the edges of the window or
     * specified container element trigger autoScroll by default
     *
     - options (boolean | object) true or false to simply enable or disable or an object with margin, distance, container and interval properties
     = (object) interact
     * or
     = (boolean | object) `false` if autoscroll is disabled and the default autoScroll settings if it is enabled
    \*/
    interact.autoScroll = function (options) {
        var defaults = defaultOptions.autoScroll;

        if (isObject(options)) {
            defaultOptions.autoScrollEnabled = true;

            if (isNumber(options.margin)) { defaults.margin = options.margin;}
            if (isNumber(options.speed) ) { defaults.speed  = options.speed ;}

            defaults.container =
                (isElement(options.container) || options.container instanceof window.Window
                 ? options.container
                 : defaults.container);

            return interact;
        }

        if (isBool(options)) {
            defaultOptions.autoScrollEnabled = options;

            return interact;
        }

        // return the autoScroll settings if autoScroll is enabled
        // otherwise, return false
        return defaultOptions.autoScrollEnabled? defaults: false;
    };

    /*\
     * interact.snap
     [ method ]
     *
     * Returns or sets whether actions are constrained to a grid or a
     * collection of coordinates
     *
     - options (boolean | object) #optional New settings
     * `true` or `false` to simply enable or disable
     * or an object with some of the following properties
     o {
     o     mode   : 'grid', 'anchor' or 'path',
     o     range  : the distance within which snapping to a point occurs,
     o     actions: ['drag', 'resizex', 'resizey', 'resizexy'], an array of action types that can snapped (['drag'] by default) (no gesture)
     o     grid   : {
     o         x, y: the distances between the grid lines,
     o     },
     o     gridOffset: {
     o             x, y: the x/y-axis values of the grid origin
     o     },
     o     anchors: [
     o         {
     o             x: x coordinate to snap to,
     o             y: y coordinate to snap to,
     o             range: optional range for this anchor
     o         }
     o         {
     o             another anchor
     o         }
     o     ]
     o }
     *
     = (object | interact) The default snap settings object or interact
    \*/
    interact.snap = function (options) {
        var snap = defaultOptions.snap;

        if (isObject(options)) {
            defaultOptions.snapEnabled = true;

            if (isString(options.mode)         ) { snap.mode          = options.mode;          }
            if (isBool  (options.endOnly)      ) { snap.endOnly       = options.endOnly;       }
            if (isNumber(options.range)        ) { snap.range         = options.range;         }
            if (isArray (options.actions)      ) { snap.actions       = options.actions;       }
            if (isArray (options.anchors)      ) { snap.anchors       = options.anchors;       }
            if (isObject(options.grid)         ) { snap.grid          = options.grid;          }
            if (isObject(options.gridOffset)   ) { snap.gridOffset    = options.gridOffset;    }
            if (isObject(options.elementOrigin)) { snap.elementOrigin = options.elementOrigin; }

            return interact;
        }
        if (isBool(options)) {
            defaultOptions.snapEnabled = options;

            return interact;
        }

        return defaultOptions.snapEnabled;
    };

    /*\
     * interact.inertia
     [ method ]
     *
     * Returns or sets inertia settings.
     *
     * See @Interactable.inertia
     *
     - options (boolean | object) #optional New settings
     * `true` or `false` to simply enable or disable
     * or an object of inertia options
     = (object | interact) The default inertia settings object or interact
    \*/
    interact.inertia = function (options) {
        var inertia = defaultOptions.inertia;

        if (isObject(options)) {
            defaultOptions.inertiaEnabled = true;

            if (isNumber(options.resistance)       ) { inertia.resistance        = options.resistance       ; }
            if (isNumber(options.minSpeed)         ) { inertia.minSpeed          = options.minSpeed         ; }
            if (isNumber(options.endSpeed)         ) { inertia.endSpeed          = options.endSpeed         ; }
            if (isNumber(options.smoothEndDuration)) { inertia.smoothEndDuration = options.smoothEndDuration; }
            if (isBool  (options.zeroResumeDelta)  ) { inertia.zeroResumeDelta   = options.zeroResumeDelta  ; }
            if (isArray (options.actions)          ) { inertia.actions           = options.actions          ; }

            return interact;
        }
        if (isBool(options)) {
            defaultOptions.inertiaEnabled = options;

            return interact;
        }

        return {
            enabled: defaultOptions.inertiaEnabled,
            resistance: inertia.resistance,
            minSpeed: inertia.minSpeed,
            endSpeed: inertia.endSpeed,
            actions: inertia.actions,
            zeroResumeDelta: inertia.zeroResumeDelta
        };
    };

    /*\
     * interact.supportsTouch
     [ method ]
     *
     = (boolean) Whether or not the browser supports touch input
    \*/
    interact.supportsTouch = function () {
        return supportsTouch;
    };

    /*\
     * interact.supportsPointerEvent
     [ method ]
     *
     = (boolean) Whether or not the browser supports PointerEvents
    \*/
    interact.supportsPointerEvent = function () {
        return supportsPointerEvent;
    };

    /*\
     * interact.currentAction
     [ method ]
     *
     = (string) What action is currently being performed
    \*/
    interact.currentAction = function () {
        for (var i = 0, len = interactions.length; i < len; i++) {
            var action = interactions[i].currentAction();

            if (action) { return action; }
        }

        return null;
    };

    /*\
     * interact.stop
     [ method ]
     *
     * Cancels the current interaction
     *
     - event (Event) An event on which to call preventDefault()
     = (object) interact
    \*/
    interact.stop = function (event) {
        for (var i = interactions.length - 1; i > 0; i--) {
            interactions[i].stop(event);
        }

        return interact;
    };

    /*\
     * interact.dynamicDrop
     [ method ]
     *
     * Returns or sets whether the dimensions of dropzone elements are
     * calculated on every dragmove or only on dragstart for the default
     * dropChecker
     *
     - newValue (boolean) #optional True to check on each move. False to check only before start
     = (boolean | interact) The current setting or interact
    \*/
    interact.dynamicDrop = function (newValue) {
        if (isBool(newValue)) {
            //if (dragging && dynamicDrop !== newValue && !newValue) {
                //calcRects(dropzones);
            //}

            dynamicDrop = newValue;

            return interact;
        }
        return dynamicDrop;
    };

    /*\
     * interact.deltaSource
     [ method ]
     * Returns or sets weather pageX/Y or clientX/Y is used to calculate dx/dy.
     *
     * See @Interactable.deltaSource
     *
     - newValue (string) #optional 'page' or 'client'
     = (string | Interactable) The current setting or interact
    \*/
    interact.deltaSource = function (newValue) {
        if (newValue === 'page' || newValue === 'client') {
            defaultOptions.deltaSource = newValue;

            return this;
        }
        return defaultOptions.deltaSource;
    };


    /*\
     * interact.restrict
     [ method ]
     *
     * Returns or sets the default rectangles within which actions (after snap
     * calculations) are restricted.
     *
     * See @Interactable.restrict
     *
     - newValue (object) #optional an object with keys drag, resize, and/or gesture and rects or Elements as values
     = (object) The current restrictions object or interact
    \*/
    interact.restrict = function (newValue) {
        var defaults = defaultOptions.restrict;

        if (newValue === undefined) {
            return defaultOptions.restrict;
        }

        if (isBool(newValue)) {
            defaultOptions.restrictEnabled = newValue;
        }
        else if (isObject(newValue)) {
            if (isObject(newValue.drag) || /^parent$|^self$/.test(newValue.drag)) {
                defaults.drag = newValue.drag;
            }
            if (isObject(newValue.resize) || /^parent$|^self$/.test(newValue.resize)) {
                defaults.resize = newValue.resize;
            }
            if (isObject(newValue.gesture) || /^parent$|^self$/.test(newValue.gesture)) {
                defaults.gesture = newValue.gesture;
            }

            if (isBool(newValue.endOnly)) {
                defaults.endOnly = newValue.endOnly;
            }

            if (isObject(newValue.elementRect)) {
                defaults.elementRect = newValue.elementRect;
            }

            defaultOptions.restrictEnabled = true;
        }
        else if (newValue === null) {
           defaults.drag = defaults.resize = defaults.gesture = null;
           defaults.endOnly = false;
        }

        return this;
    };

    /*\
     * interact.pointerMoveTolerance
     [ method ]
     * Returns or sets the distance the pointer must be moved before an action
     * sequence occurs. This also affects tolerance for tap events.
     *
     - newValue (number) #optional The movement from the start position must be greater than this value
     = (number | Interactable) The current setting or interact
    \*/
    interact.pointerMoveTolerance = function (newValue) {
        if (isNumber(newValue)) {
            defaultOptions.pointerMoveTolerance = newValue;

            return this;
        }

        return defaultOptions.pointerMoveTolerance;
    };

    function endAllInteractions (event) {
        for (var i = 0; i < interactions.length; i++) {
            interactions[i].pointerUp(event);
        }
    }

    if (PointerEvent) {
        if (PointerEvent === window.MSPointerEvent) {
            pEventTypes = {
                up: 'MSPointerUp', down: 'MSPointerDown', over: 'MSPointerOver',
                out: 'MSPointerOut', move: 'MSPointerMove', cancel: 'MSPointerCancel' };
        }
        else {
            pEventTypes = {
                up: 'pointerup', down: 'pointerdown', over: 'pointerover',
                out: 'pointerout', move: 'pointermove', cancel: 'pointercancel' };
        }

        events.add(docTarget, pEventTypes.up    , listeners.collectTaps);

        events.add(docTarget, pEventTypes.move  , listeners.recordPointers);

        events.add(docTarget, pEventTypes.down  , listeners.selectorDown);
        events.add(docTarget, pEventTypes.move  , listeners.pointerMove );
        events.add(docTarget, pEventTypes.up    , listeners.pointerUp   );
        events.add(docTarget, pEventTypes.over  , listeners.pointerOver );
        events.add(docTarget, pEventTypes.out   , listeners.pointerOut  );

        // remove pointers after ending actinos in pointerUp
        events.add(docTarget, pEventTypes.up    , listeners.recordPointers);
        events.add(docTarget, pEventTypes.cancel, listeners.recordPointers);
    }
    else {
        events.add(docTarget, 'mouseup' , listeners.collectTaps);
        events.add(docTarget, 'touchend', listeners.collectTaps);

        events.add(docTarget, 'mousemove'  , listeners.recordPointers);
        events.add(docTarget, 'touchmove'  , listeners.recordTouches );
        events.add(docTarget, 'touchcancel', listeners.recordTouches );


        events.add(docTarget, 'mousedown', listeners.selectorDown);
        events.add(docTarget, 'mousemove', listeners.pointerMove );
        events.add(docTarget, 'mouseup'  , listeners.pointerUp   );
        events.add(docTarget, 'mouseover', listeners.pointerOver );
        events.add(docTarget, 'mouseout' , listeners.pointerOut  );

        events.add(docTarget, 'touchstart' , listeners.selectorDown);
        events.add(docTarget, 'touchmove'  , listeners.pointerMove );
        events.add(docTarget, 'touchend'   , listeners.pointerUp   );
        events.add(docTarget, 'touchcancel', listeners.pointerUp   );

        // remove touches after ending actinos in pointerUp
        events.add(docTarget, 'touchend'   , listeners.recordTouches);
    }

    events.add(windowTarget, 'blur', endAllInteractions);

    try {
        if (window.frameElement) {
            parentDocTarget._element = window.frameElement.ownerDocument;

            events.add(parentDocTarget   , 'mouseup'      , listeners.pointerUp);
            events.add(parentDocTarget   , 'touchend'     , listeners.pointerUp);
            events.add(parentDocTarget   , 'touchcancel'  , listeners.pointerUp);
            events.add(parentDocTarget   , 'pointerup'    , listeners.pointerUp);
            events.add(parentDocTarget   , 'MSPointerUp'  , listeners.pointerUp);
            events.add(parentWindowTarget, 'blur'         , endAllInteractions );
        }
    }
    catch (error) {
        interact.windowParentError = error;
    }

    function indexOf (array, target) {
        for (var i = 0, len = array.length; i < len; i++) {
            if (array[i] === target) {
                return i;
            }
        }

        return -1;
    }

    function contains (array, target) {
        return indexOf(array, target) !== -1;
    }

    // For IE's lack of Event#preventDefault
    if (events.useAttachEvent) {
        events.add(docTarget, 'selectstart', function (event) {
            var interaction = interactions[0];

            if (interaction.currentAction()) {
                interaction.checkAndPreventDefault(event);
            }
        });
    }

    function matchesSelector (element, selector, nodeList) {
        if (ie8MatchesSelector) {
            return ie8MatchesSelector(element, selector, nodeList);
        }

        return element[prefixedMatchesSelector](selector);
    }

    // For IE8's lack of an Element#matchesSelector
    // taken from http://tanalin.com/en/blog/2012/12/matches-selector-ie8/ and modified
    if (!(prefixedMatchesSelector in Element.prototype) || !isFunction(Element.prototype[prefixedMatchesSelector])) {
        ie8MatchesSelector = function (element, selector, elems) {
            elems = elems || element.parentNode.querySelectorAll(selector);

            for (var i = 0, len = elems.length; i < len; i++) {
                if (elems[i] === element) {
                    return true;
                }
            }

            return false;
        };
    }

    // requestAnimationFrame polyfill
    (function() {
        var lastTime = 0,
            vendors = ['ms', 'moz', 'webkit', 'o'];

        for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
            reqFrame = window[vendors[x]+'RequestAnimationFrame'];
            cancelFrame = window[vendors[x]+'CancelAnimationFrame'] || window[vendors[x]+'CancelRequestAnimationFrame'];
        }

        if (!reqFrame) {
            reqFrame = function(callback) {
                var currTime = new Date().getTime(),
                    timeToCall = Math.max(0, 16 - (currTime - lastTime)),
                    id = window.setTimeout(function() { callback(currTime + timeToCall); },
                  timeToCall);
                lastTime = currTime + timeToCall;
                return id;
            };
        }

        if (!cancelFrame) {
            cancelFrame = function(id) {
                clearTimeout(id);
            };
        }
    }());

    /* global exports: true, module, define */

    // http://documentcloud.github.io/underscore/docs/underscore.html#section-11
    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = interact;
        }
        exports.interact = interact;
    }
    // AMD
    else if (typeof define === 'function' && define.amd) {
        define('interact', function() {
            return interact;
        });
    }
    else {
        window.interact = interact;
    }

} ());
