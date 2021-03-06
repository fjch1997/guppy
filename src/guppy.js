var Mousetrap = require('../lib/mousetrap/mousetrap.min.js');
var katex = require('../lib/katex/katex-modified.min.js');
var Engine = require('./engine.js');
var Utils = require('./utils.js');
var Symbols = require('./symbols.js');
var Settings = require('./settings.js');
var Doc = require('./doc.js');

/**
   @class
   @classdesc An instance of Guppy.  Calling `Guppy(id)` with the ID of
   an existing editor will simply return that instance.
   @param {string} id - The string ID of the element that should be converted to an editor.  
   @param {Object} [config] - The configuration options for this instance
   @param {Object} [config.events] - A dictionary of events.
   Available events are as specified in Guppy.init.  Values in this
   dictionary will, for this instance of the editor, override events
   specified through Guppy.init.
   @param {Object} [config.settings] - A dictionary of settings.
   Values in this dictionary will override any global settings
   specified in `Guppy.init`.  This dictionary takes the same keys as
   the `config.settings` dictionary passed to `Guppy.init`.  See that
   function's documentation for the complete list.
   @constructor 
*/
var Guppy = function(id, config){
    if(Guppy.instances[id]){
        if(Guppy.instances[id].ready){
            return Guppy.instances[id];
        }
        return null;
    }
    var self = this;
    config = config || {};
    var settings = config['settings'] || {};
    
    this.id = id;
    var guppy_div = document.getElementById(id);
    
    var tab_idx = Guppy.max_tabIndex || 0;
    guppy_div.tabIndex = tab_idx;
    Guppy.max_tabIndex = tab_idx+1;

    var buttons = settings['buttons'] || Settings.config.settings['buttons'];
    this.buttons_div = document.createElement("div");
    this.buttons_div.setAttribute("class","guppy_buttons");
    if(buttons){
        for(var i = 0; i < buttons.length; i++){
            if(buttons[i] == "osk" && Settings.osk){
                this.buttons_div.appendChild(Guppy.make_button("icons/keyboard.png", function() {
                    if(Settings.osk.guppy == self){ Settings.osk.detach(self); }
                    else{ Settings.osk.attach(self); }}));
            }
            else if(buttons[i] == "settings") this.buttons_div.appendChild(Guppy.make_button("icons/settings.png", function(){ Settings.toggle("settings", self); }));
            else if(buttons[i] == "symbols") this.buttons_div.appendChild(Guppy.make_button("icons/symbols.png", function(){ Settings.toggle("symbols", self); }));
            else if(buttons[i] == "controls") this.buttons_div.appendChild(Guppy.make_button("icons/help.png", function(){ Settings.toggle("controls", self); }));
        }
    }

    this.editor_active = true;
    //this.empty_content = settings['empty_content'] || "\\red{[?]}"
    this.editor = guppy_div;
    this.blacklist = [];
    this.autoreplace = true;
    this.ready = false;

    Guppy.instances[guppy_div.id] = this;

    config['parent'] = self;

    /**   @member {Engine} */
    this.engine = new Engine(config);
    this.temp_cursor = {"node":null,"caret":0}
    this.editor.addEventListener("keydown",Guppy.key_down, false);
    this.editor.addEventListener("keyup",Guppy.key_up, false);
    this.editor.addEventListener("focus", function() { Guppy.kb.alt_down = false; if(self.activate) self.activate();}, false);
    if(Guppy.ready && !this.ready){
        this.ready = true;
        this.engine.fire_event("ready");
        this.render(true);
    }
    this.deactivate();
    this.recompute_locations_paths();
}

Guppy.instances = {};
Guppy.ready = false;
Guppy.Doc = Doc;
Guppy.active_guppy = null;
Guppy.Symbols = Symbols;

Guppy.make_button = function(url, cb){
    var b = document.createElement("img");
    b.setAttribute("class","guppy-button");
    b.setAttribute("src", Settings.config.path + "/" + url);
    if(cb){
        b.onclick = function(e){
            cb(e);
            if(e.cancelBubble!=null) e.cancelBubble = true;
            if(e.stopPropagation) e.stopPropagation();
            e.preventDefault();
            return false;
        };
    }
    return b;
}

/** 
    Add a symbol to all instances of the editor
    @memberof Guppy
    @param {string} name - The name of the symbol to add.  This is
    also the string that will be autoreplaced with the symbol.
    @param {Object} symbol - If `template` is present, this is just
    the template arguments.  Otherwise, it is the complete symbol specification
    @param {Object} symbol.output - Key/value pairs where the key is
    the output type (such as "latex" or "asciimath") and the value is
    the string by which the output will be rendered in that format.
    In this string, {$n} will be substituted with the rendering of the
    nth argument.  If the nth argument is a d-dimensional list, then
    the argument should be specified as {$n{sep_1}{sep_2}...{sep_d}}
    where sep_i will be the separator used to separate entries in the
    ith dimension.  Note that keys are not necessary to describe the
    AST or plain-text outputs.
    @param {Object} symbol.attrs - A specification of the attributes
    of the symbol
    @param {string} symbol.attrs.type - A longer description of the
    symbol type, suitable for searching and text rendering.
    @param {string} symbol.attrs.group - The group in which to place
    this symbol (for OSK)
    @param {Object} [symbol.input] - If the symbol should subsume part
    of the existing content of the editor (as in, for example, the
    case of exponent), this object will contain the (1-based) index of
    the argument in which that content should be placed.
    @param {Object} [symbol.ast] - Modifies the default construction
    of an entry in the AST for this symbol.  
    @param {Object} [symbol.ast.type="operator"] - The type of symbol
    for AST purposes.  Can be "name" (meaning this symbol represents
    a variable, as in the case of pi), "number" (meaning this symbol
    is a literal value), "operator" (meaning this symbol is a
    function or otherwise takes arguments (as in cos or +), or
    "pass" (meaning this symbol's first argument will be used as its
    AST entry, as in the case of brackets/parentheses).
    @param {Object[]} [symbol.args] - A list of specifications, one
    for each argument
    @param {string} [symbol.args.down] - The index of the argument
    to jump to when the "down" arrow is pressed in this argument
    @param {string} [symbol.args.up] - The index of the argument
    to jump to when the "up" arrow is pressed in this argument
    @param {string} [symbol.args.small="no"] - "yes" if the symbol is
    small (as in an exponent)
    @param {string} [symbol.args.name] - The name of this particular
    argument (suitable for searching)
    @param {string} [symbol.args.bracket="no"] - "yes" if brackets
    should automatically be rendered around this argument when they
    might be needed to disambiguate.
    @param {string} [symbol.args.delete] - If present, when the
    "backspace" key is pressed at the beginning of this argument,
    the symbol will be deleted and replaced with the argument whose
    index is specified in this parameter.  For example, the second
    argument of an exponent has this value set to "1", so that when
    the exponent is deleted, the base remains.
    @param {string} [symbol.args.mode="math"] - Change the mode of an
    argument.  Can be "text" (meaning the argument will be editable
    as and rendered as plain text), "symbol" (meaning the argument
    will specify a symbol name and will complete to an actual symbol
    when this is entered--only used for the backslash symbol), or
    "math" (the default)
    @param {string} [symbol.args.is_bracket="no"] - Set to "yes" if
    the symbol is itself a bracket/parenthesis equivalent.
    @param {string} [template] - The name of the template to use
*/
Guppy.add_global_symbol = function(name, symbol, template){
    if(template){
        symbol = Symbols.make_template_symbol(template, name, symbol);
    }
    Symbols.symbols[name] = JSON.parse(JSON.stringify(symbol));
    for(var i in Guppy.instances){
        Guppy.instances[i].engine.symbols[name] = JSON.parse(JSON.stringify(symbol));
    }
}

/** 
    Remove a symbol from all instances of the editor
    @memberof Guppy
    @param {string} name - The name of the symbol to remove
*/
Guppy.remove_global_symbol = function(name){
    if(Symbols.symbols[name]){
        delete Symbols.symbols[name]
        for(var i in Guppy.instances){
            if(Guppy.instances[i].engine.symbols[name]){
                delete Guppy.instances[i].engine.symbols[name];
            }
        }
    }
}

/**
   Initialise global settings for all instances of the editor.  Most
   of these can be overridden for specific instances later.  Should be
   called before instantiating the Guppy class.
   @static 
   @memberof Guppy
   @param {Object} config - The configuration options for this instance
   @param {string[]} [config.symbols] - A list of URLs for symbol JSON files to request
   @param {string} [config.path="/lib/guppy"] - The path to the guppy build folder.
   @param {GuppyOSK} [config.osk] - A GuppyOSK object to use for the on-screen keyboard if one is desired
   @param {Object} [config.events] - A dictionary of events
   @param {function} [config.events.ready] - Called when the instance is ready to render things. 
   @param {function} [config.events.change] - Called when the editor's content changes.  Argument will be a dictionary with keys `old` and `new` containing the old and new documents, respectively. 
   @param {function} [config.events.left_end] - Called when the cursor is at the left-most point and a command is received to move the cursor to the left (e.g., via the left arrow key).  Argument will be null.
   @param {function} [config.events.left_end] - Called when the cursor is at the right-most point and a command is received to move the cursor to the right (e.g., via the right arrow key).  Argument will be null.
   @param {function} [config.events.done] - Called when the enter key is pressed in the editor.
   @param {function} [config.events.completion] - Called when the editor outputs tab completion
   options.  Argument is a dictionary with the key `candidates`, a
   list of the options for tab-completion.
   @param {function} [config.events.debug] - Called when the editor outputs some debug information.
   Argument is a dictionary with the key `message`.
   @param {function} [config.events.error] - Called when the editor receives an error.  Argument is
   a dictionary with the key `message`.
   @param {function} [config.events.focus] - Called when the editor is focused or unfocused.
   Argument will have a single key `focused` which will be `true`
   or `false` according to whether the editor is newly focused or
   newly unfocused (respectively).
   @param {Object} [config.settings] - A dictionary of settings
   @param {string} [config.settings.xml_content=<m><e/></m>] - An XML
   string with which to initialise the editor's state.
   @param {string} [config.settings.autoreplace="auto"] - Determines
   whether or not to autoreplace typed text with the corresponding
   symbols when possible.
   @param {string} [config.settings.blank_caret=""] - A LaTeX string
   that specifies what the caret should look like when in a blank
   spot.  If `""`, the default caret is used.
   @param {string} [config.settings.empty_content=\color{red}{[?]}] - A
   LaTeX string that will be displayed when the editor is both
   inactive and contains no content.
   @param {string[]} [config.settings.blacklist=[]] - A list of string
   symbol names, corresponding to symbols that should not be
   allowed in this instance of the editor.
   @param {string[]} [config.settings.buttons=["osk","settings","symbols","controls"]] - A list of strings corresponding to the helper buttons that should be displayed in the editor when focused.
   @param {string} [config.settings.cliptype] - A string, either
   "text" or "latex".  If this option is present, when text is
   placed onto the editor clipboard, the contents of the editor
   will be rendered into either plain text or LaTeX (depending on
   the value of this option) and an attempt will be made to copy
   the result to the system clipboard.
   @param {function} [config.callback] - A function to be called when
   initialisation is complete.
*/
Guppy.init = function(config){
    var all_ready = function(){
        Settings.init(Symbols.symbols);
        Guppy.register_keyboard_handlers();
        for(var i in Guppy.instances){
            Guppy.instances[i].ready = true;
            Guppy.instances[i].render(true);

            // Set backend symbols
            Guppy.instances[i].engine.symbols = JSON.parse(JSON.stringify(Symbols.symbols));

            // Set backend settings
            // for(var s in Settings.config.settings){
            //     Guppy.instances[i].engine.settings[s] = JSON.parse(JSON.stringify(Settings.config.settings[s]));
            // }

            // Set backend events
            for(var e in Settings.config.events){
                Guppy.instances[i].engine.events[e] = Settings.config.events[e];
            }
        }
        Engine.ready = true;
        for(var j in Guppy.instances){
            Guppy.instances[j].engine.ready = true;
            Guppy.instances[j].engine.fire_event("ready");
        }
	if(config.callback) config.callback();
    }
    if(config.settings){
        var settings = JSON.parse(JSON.stringify(config.settings));
        for(var s in settings){
            Settings.config.settings[s] = settings[s];
        }
    }
    if(config.events){
        Settings.config.events = config.events;
    }
    if(config.osk){
	Guppy.OSK = config.osk;
        Settings.osk = config.osk;
        if(config.osk.config.attach == "focus"){
            var f = Settings.config.events["focus"];
            Settings.config.events["focus"] = function(e){
                if(f) f(e);
                if(e.focused) config.osk.attach(e.target);
                else config.osk.detach(e.target);
            };
        }
    }
    if(config.path){
        Settings.config.path = config.path;
    }
    if(config.symbols){
        var symbols = config.symbols;
        if(!(Array.isArray(symbols))){
            symbols = [symbols];
        }
        var calls = [];
        for(var i = 0; i < symbols.length; i++){
            var x = function outer(j){
                return function(callback){
                    var req = new XMLHttpRequest();
                    req.onload = function(){
                        var syms = JSON.parse(this.responseText);
                        Symbols.add_symbols(syms);
                        callback();
                    };
                    req.open("get", symbols[j], true);
                    req.send();
                }
            }(i);
            calls.push(x);
        }
        calls.push(all_ready);
        var j = 0;
        var cb = function(){
            j += 1;
            if(j < calls.length) calls[j](cb);
        }
        if(calls.length > 0) calls[0](cb);
    }
    else{
        all_ready();
    }
}

Guppy.prototype.is_changed = function(){
    var bb = this.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    var rect = bb.getBoundingClientRect();
    var ans = null;
    if(this.bounding_box)
        ans = this.bounding_box.top != rect.top || this.bounding_box.bottom != rect.bottom || this.bounding_box.right != rect.right || this.bounding_box.left != rect.left;
    else
        ans = true;
    this.bounding_box = rect;
    return ans;
}

Guppy.prototype.recompute_locations_paths = function(){
    var ans = [];
    var bb = this.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    var rect = bb.getBoundingClientRect();
    ans.push({'path':'all',
              'top':rect.top,
              'bottom':rect.bottom,
              'left':rect.left,
              'right':rect.right});
    var elts = this.editor.getElementsByClassName("guppy_elt");
    for(var i = 0; i < elts.length; i++){
        var elt = elts[i];
        if(elt.nodeName == "mstyle") continue;
        rect = elt.getBoundingClientRect();
        if(rect.top == 0 && rect.bottom == 0 && rect.left == 0 && rect.right == 0) continue;
        var cl = elt.classList;
        for(var j = 0; j < cl.length; j++){
            if(cl[j].indexOf("guppy_loc") == 0){
                ans.push({'path':cl[j],
                          'top':rect.top,
                          'bottom':rect.bottom,
                          'left':rect.left,
                          'right':rect.right,
                          'mid_x':(rect.left+rect.right)/2,
                          'mid_y':(rect.bottom+rect.top)/2,
                          'blank':(' '+elt.className+' ').indexOf(' guppy_blank ') >= 0});
                break;
            }
        }
    }
    this.boxes = ans;
}

Guppy.get_loc = function(x,y,current_node,current_caret){
    var g = Guppy.active_guppy;
    var min_dist = -1;
    var mid_dist = 0;
    var pos = "";
    var opt = null;
    var cur = null;
    var car = null;
    // check if we go to first or last element
    var bb = g.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    if(current_node){
        var current_path = Utils.path_to(current_node);
        var current_pos = parseInt(current_path.substring(current_path.lastIndexOf("e")+1));
    }
    
    var boxes = g.boxes;
    if(!boxes) return;
    if(current_node){
        current_path = current_path.replace(/e[0-9]+$/,"e");
        var boxes2 = [];
        for(var i = 0; i < boxes.length; i++){
            if(boxes[i].path == "all") continue;
            var loc = boxes[i].path.substring(0,boxes[i].path.lastIndexOf("_"));
            loc = loc.replace(/e[0-9]+$/,"e");
            if(loc == current_path){
                boxes2.push(boxes[i]);
            }
        }
        boxes = boxes2;
    }
    if(!boxes) return;
    for(var j = 0; j < boxes.length; j++){
        var box = boxes[j];
        if(box.path == "all"){
            if(!opt) opt = {'path':'guppy_loc_m_e1_0'};
            continue;
        }
        var xdist = Math.max(box.left - x, x - box.right, 0)
        var ydist = Math.max(box.top - y, y - box.bottom, 0)
        var dist = Math.sqrt(xdist*xdist + ydist*ydist);
        if(min_dist == -1 || dist < min_dist){
            min_dist = dist;
            mid_dist = x - box.mid_x;
            opt = box;
        }
    }
    loc = opt.path.substring("guppy_loc".length);
    loc = loc.replace(/_/g,"/");
    loc = loc.replace(/([0-9]+)(?=.*?\/)/g,"[$1]");
    cur = g.engine.doc.xpath_node(loc.substring(0,loc.lastIndexOf("/")), g.engine.doc.root());
    car = parseInt(loc.substring(loc.lastIndexOf("/")+1));
    // Check if we want the cursor before or after the element
    if(mid_dist > 0 && !(opt.blank)){
        car++;
    }
    var ans = {"current":cur,"caret":car,"pos":pos};
    if(current_node && opt){
        var opt_pos = parseInt(opt.path.substring(opt.path.lastIndexOf("e")+1,opt.path.lastIndexOf("_")));
        if(opt_pos < current_pos) pos = "left";
        else if(opt_pos > current_pos) pos = "right";
        else if(car < current_caret) pos = "left";
        else if(car > current_caret) pos = "right";
        if(pos) ans['pos'] = pos;
        else ans['pos'] = "none";
    }
    return ans;
}

Guppy.mouse_up = function(){
    Guppy.kb.is_mouse_down = false;
    var g = Guppy.active_guppy;
    if(g) g.render(true);
}

Guppy.mouse_down = function(e){
    if(e.target.getAttribute("class") == "guppy-button") return;
    var n = e.target;
    Guppy.kb.is_mouse_down = true;
    while(n != null){
        if(n.id in Guppy.instances){
            e.preventDefault();
            var prev_active = Guppy.active_guppy;
            for(var i in Guppy.instances){
                if(i != n.id) Guppy.instances[i].deactivate();
                Guppy.active_guppy = Guppy.instances[n.id];
                Guppy.active_guppy.activate();
            }
            var g = Guppy.active_guppy;
            var b = Guppy.active_guppy.engine;
            g.space_caret = 0;
            if(prev_active == g){
                if(e.shiftKey){
                    g.select_to(e.clientX, e.clientY, true);
                }
                else {
                    var loc = Guppy.get_loc(e.clientX,e.clientY);
                    if(!loc) return;
                    b.current = loc.current;
                    b.caret = loc.caret;
                    b.sel_status = Engine.SEL_NONE;
                }
                g.render(true);
            }
            return;
        }
        if(n.classList && n.classList.contains("guppy_osk")){
            return;
        }
        n = n.parentNode;
    }
    Guppy.active_guppy = null;
    for(var j in Guppy.instances){
        Guppy.instances[j].deactivate();
    }
}

Guppy.mouse_move = function(e){
    var g = Guppy.active_guppy;
    if(!g) return;
    if(!Guppy.kb.is_mouse_down){
        var bb = g.editor;
        var rect = bb.getBoundingClientRect();
        if((e.clientX < rect.left || e.clientX > rect.right) || (e.clientY > rect.bottom || e.clientY < rect.top)){
            g.temp_cursor = {"node":null,"caret":0};
        }
        else{
            var loc = Guppy.get_loc(e.clientX,e.clientY);
            if(!loc) return;
            g.temp_cursor = {"node":loc.current,"caret":loc.caret};
        }
        g.render(g.is_changed());
    }
    else{
        g.select_to(e.clientX,e.clientY, true);
        g.render(g.is_changed());
    }
}

Guppy.prototype.select_to = function(x, y, mouse){
    var sel_caret = this.engine.caret;
    var sel_cursor = this.engine.current;
    if(this.engine.sel_status == Engine.SEL_CURSOR_AT_START){
        sel_cursor = this.engine.sel_end.node;
        sel_caret = this.engine.sel_end.caret;
    }
    else if(this.engine.sel_status == Engine.SEL_CURSOR_AT_END){
        sel_cursor = this.engine.sel_start.node;
        sel_caret = this.engine.sel_start.caret;
    }
    var loc = Guppy.get_loc(x,y,sel_cursor,sel_caret);
    if(!loc) return;
    this.engine.select_to(loc, sel_cursor, sel_caret, mouse);
}


window.addEventListener("mousedown",Guppy.mouse_down, false);
window.addEventListener("mouseup",Guppy.mouse_up, false);
window.addEventListener("mousemove",Guppy.mouse_move, false);

Guppy.prototype.render_node = function(t){
    // All the interesting work is done by transform.  This function just adds in the cursor and selection-start cursor
    var output = "";
    if(t == "render"){
        var root = this.engine.doc.root();
        this.engine.add_paths(root,"m");
        this.engine.temp_cursor = this.temp_cursor;
        this.engine.add_classes_cursors(root);
        this.engine.current.setAttribute("current","yes");
        if(this.temp_cursor.node) this.temp_cursor.node.setAttribute("temp","yes");
        output = this.engine.get_content("latex",true);
        this.engine.remove_cursors_classes(root);
        output = output.replace(new RegExp('&amp;','g'), '&');
        return output;
    }
    else{
        output = this.engine.get_content(t);
    }
    return output
}

/** 
    Render the document
    @memberof Guppy
    @param {boolean} [updated=false] - Whether there have been visible
    changes to the document (i.e. that affect the positions of
    elements)
*/
Guppy.prototype.render = function(updated){
    if(!this.editor_active && this.engine.doc.is_blank()){
        katex.render(this.engine.setting("empty_content"),this.editor);
        this.editor.appendChild(this.buttons_div);
        return;
    }
    var tex = this.render_node("render");
    katex.render(tex,this.editor);
    this.editor.appendChild(this.buttons_div);
    if(updated){
        this.recompute_locations_paths();
    }
}

/** 
    Get the content of the editor as LaTeX
    @memberof Guppy
*/
Guppy.prototype.latex = function(){
    return this.engine.get_content("latex");
}

/** 
    Get the content of the editor as XML
    @memberof Guppy
*/
Guppy.prototype.xml = function(){
    return this.engine.get_content("xml");
}

/** 
    Get the content of the editor as a syntax tree, serialised using JSON
    @memberof Guppy
*/
Guppy.prototype.syntax_tree = function(){
    return this.engine.get_content("ast");
}

/** 
    Get the content of the editor as a list of equations, serialised
    using JSON.  For example, `x < y = z` will be returned as `[["<", [["var", "x"], ["var", "y"]]],["=", [["var", "y"], ["var", "z"]]]]
    @memberof Guppy
*/
Guppy.prototype.equations = function(){
    return this.engine.get_content("eqns");
}

/** 
    Get the content of the editor in a parseable text format.
    @memberof Guppy
*/
Guppy.prototype.text = function(){
    return this.engine.get_content("text");
}


/** 
    Get the content of the editor in AsciiMath.
    @memberof Guppy
*/
Guppy.prototype.asciimath = function(){
    return this.engine.get_content("asciimath");
}

/** 
    Get the Doc object representing the editor's contents.
    @memberof Guppy
*/
Guppy.prototype.doc = function(){
    return this.engine.doc;
}

/** 
    Get the content of the editor as a Javascript function, with
    user-supplied interpretations of the various symbols.  If not
    supplied, default interpretations will be given for the following
    symbols: `*,+,/,-,^,sqrt,sin,cos,tan,log`
    @param {Object} [evaluators] - An object with a key for each
    possible symbol type ("exponential", "integral", etc.)
    whose values are functions.  These functions take in a single
    argument, `args`, which is an array of that symbol's arguments,
    and should return a function that takes in an object argument
    `vars`.  In this inner function, to compute e.g. the sum of the
    first and second arguments, you would do
    `args[0](vars)+args[1](vars)`.  This function should return the
    result of that symbol's operation.  
    @returns {function(Object)} - Returns a function that takes in an
    object with a key for each variable in the expression and whose
    values are the values that will be passed in for those variables.
    In addition, this function is augmented with a `vars` member which
    is a list of the variables that appear in the expression.
    @memberof Guppy
*/
Guppy.prototype.func = function(evaluators){
    var res = this.engine.get_content("function", evaluators);
    var f = res['function'];
    f.vars = res.vars;
    return f;
}

/** 
    Recursively evaluate the syntax tree of the editor's contents using specified functions.
    @param {Object} [evaluators] - An object with a key for each
    possible symbol type ("exponential", "integral", etc.)
    whose values are functions that will be applied whenever that
    symbol is encountered in the syntax tree.  These functions take a
    single argument, `args`, which is a list of the results of
    evaluating that symbol's arguments.  
    @returns - Whatever the `evaluators` function for the root symbol
    in the syntax tree returns.
    @memberof Guppy
*/
Guppy.prototype.evaluate = function(evaluators){
    return this.engine.doc.evaluate(evaluators);
}

/** 
    Get a list of the symbols used in the document, in order of
    appearance, with each kind of symbol appearing only once.  For
    example, a document representing `sin(x^3)+sqrt(x^2+x)` will
    have symbols `["sin","exponential","square_root"]`.
    @param {String[]} [groups] - A list of the groups whose symbols
    may be included in the output.  If absent, all symbols in the
    document will be returned.
    @memberof Guppy
*/
Guppy.prototype.symbols_used = function(groups){
    return this.engine.doc.get_symbols(groups);
}

/** 
    Get a list of the variable names used in the document.  
    @memberof Guppy
*/
Guppy.prototype.vars = function(){
    return this.engine.get_content("function").vars;
}

/** 
    Set the content of the document from text in the format outputted by `guppy.text()`.
    @param {String} text - A string representing the document to import.
    @memberof Guppy
*/
Guppy.prototype.import_text = function(text){
    return this.engine.import_text(text);
}

/** 
    Set the content of the document from input text in "semantic
    LaTeX" format.  That is, all functions are represented as
    `\funcname{arg1}{arg2}`.  For example,
    `\defintegral{1}{2}{x^2}{x}`.
    @param {String} text - A string representing the document to import.
    @memberof Guppy
*/
Guppy.prototype.import_latex = function(text){
    return this.engine.import_latex(text);
}

/** 
    Set the content of the document from XML in the format outputted
    by `guppy.xml()`.
    @param {String} xml - An XML string representing the document to
    import.
    @memberof Guppy
*/
Guppy.prototype.import_xml = function(xml){
    return this.engine.set_content(xml);
}

/** 
    Import a syntax tree from a JSON object formatted as outputted by `guppy.syntax_tree()`.
    @param {Object} tree - A JSON object representing the syntax tree to import.
    @memberof Guppy
*/
Guppy.prototype.import_syntax_tree = function(tree){
    return this.engine.import_ast(tree);
}

/** 
    Focus this instance of the editor
    @memberof Guppy
*/
Guppy.prototype.activate = function(){
    Guppy.active_guppy = this;
    this.editor_active = true;
    this.editor.className = this.editor.className.replace(new RegExp('(\\s|^)guppy_inactive(\\s|$)'),' guppy_active ');
    this.editor.focus();
    if(this.ready){
        this.render(true);
        this.engine.fire_event("focus",{"focused":true});
    }
}

/** 
    Unfocus this instance of the editor
    @memberof Guppy
*/
Guppy.prototype.deactivate = function(){
    this.editor_active = false;
    var r1 = new RegExp('(?:\\s|^)guppy_active(?:\\s|$)');
    var r2 = new RegExp('(?:\\s|^)guppy_inactive(?:\\s|$)');
    if(this.editor.className.match(r1)){
        this.editor.className = this.editor.className.replace(r1,' guppy_inactive ');
    }
    else if(!this.editor.className.match(r2)){
        this.editor.className += ' guppy_inactive ';
    }
    Guppy.kb.shift_down = false;
    Guppy.kb.ctrl_down = false;
    Guppy.kb.alt_down = false;
    if(this.ready){
        this.render();
        this.engine.fire_event("focus",{"focused":false});
    }
}


// Keyboard stuff

Guppy.kb = {};

Guppy.kb.is_mouse_down = false;

/* keyboard behaviour definitions */

// keys aside from 0-9,a-z,A-Z
Guppy.kb.k_chars = {
    "+":"+",
    "-":"-",
    "*":"*",
    ".":".",
    "shift+/":"/",
    "shift+=":"+",
};
Guppy.kb.k_syms = {
    "/":"fraction",
    "^":"exponential",
    "*":"*",
    "(":"bracket",
    "=":"=",
    "[":"matrix",
    "{":"vector",
    "<":"<",
    ">":">",
    "_":"subscript",
    "|":"absolutevalue",
    "!":"factorial",
    "shift+up":"exponential",
    "shift+down":"subscript"
};
Guppy.kb.k_text = {
    "/":"/",
    "*":"*",
    "(":"(",
    ")":")",
    "<":"<",
    ">":">",
    "|":"|",
    "!":"!",
    ",":",",
    ".":".",
    ";":";",
    "=":"=",
    "[":"[",
    "]":"]",
    "@":"@",
    "'":"'",
    "`":"`",
    ":":":",
    "\"":"\"",
    "shift+/":"?",
    "space":" ",
};
Guppy.kb.k_controls = {
    "up":"up",
    "down":"down",
    "right":"right",
    "left":"left",
    "alt+k":"up",
    "alt+j":"down",
    "alt+l":"right",
    "alt+h":"left",
    "space":"spacebar",
    "home":"home",
    "end":"end",
    "backspace":"backspace",
    "del":"delete_key",
    "mod+a":"sel_all",
    "mod+c":"sel_copy",
    "mod+x":"sel_cut",
    "mod+v":"sel_paste",
    "mod+z":"undo",
    "mod+y":"redo",
    "enter":"done",
    "mod+shift+right":"list_extend_copy_right",
    "mod+shift+left":"list_extend_copy_left",
    ",":"list_extend_right",
    ";":"list_extend_down",
    "mod+right":"list_extend_right",
    "mod+left":"list_extend_left",
    "mod+up":"list_extend_up",
    "mod+down":"list_extend_down",
    "mod+shift+up":"list_extend_copy_up",
    "mod+shift+down":"list_extend_copy_down",
    "mod+backspace":"list_remove",
    "mod+shift+backspace":"list_remove_row",
    "shift+left":"sel_left",
    "shift+right":"sel_right",
    ")":"right_paren",
    "\\":"backslash",
    "tab":"tab"
};

var i = 0;

// letters

for(i = 65; i <= 90; i++){
    Guppy.kb.k_chars[String.fromCharCode(i).toLowerCase()] = String.fromCharCode(i).toLowerCase();
    Guppy.kb.k_chars['shift+'+String.fromCharCode(i).toLowerCase()] = String.fromCharCode(i).toUpperCase();
}

// numbers

for(i = 48; i <= 57; i++)
    Guppy.kb.k_chars[String.fromCharCode(i)] = String.fromCharCode(i);

Guppy.register_keyboard_handlers = function(){
    Mousetrap.addKeycodes({173: '-'}); // Firefox's special minus (needed for _ = sub binding)
    var i = 0;
    for(i in Guppy.kb.k_chars)
        Mousetrap.bind(i,function(i){ return function(){
            if(!Guppy.active_guppy) return true;
            Guppy.active_guppy.temp_cursor.node = null;
            if(Utils.is_text(Guppy.active_guppy.engine.current) && Guppy.kb.k_text[i]){
                Guppy.active_guppy.engine.insert_string(Guppy.kb.k_text[i]);
            }
            else{
                Guppy.active_guppy.engine.insert_string(Guppy.kb.k_chars[i]);
            }
            Guppy.active_guppy.render(true);
            return false;
        }}(i));  
    for(i in Guppy.kb.k_syms)
        Mousetrap.bind(i,function(i){ return function(){
            if(!Guppy.active_guppy) return true;
            Guppy.active_guppy.temp_cursor.node = null;
            // We always want to skip using this symbol insertion if
            // we are in text mode, and additionally we want only to
            // insert the corresponding text if there is an overriding
            // text representation in Guppy.kb.k_text
            if(Utils.is_text(Guppy.active_guppy.engine.current)){
                if(Guppy.kb.k_text[i]) Guppy.active_guppy.engine.insert_string(Guppy.kb.k_text[i]);
            }
            else{
                Guppy.active_guppy.engine.space_caret = 0;
                //Guppy.active_guppy.engine.insert_symbol(Guppy.kb.k_syms[i]);
		Guppy.active_guppy.engine.insert_symbol(Symbols.lookup_type(Guppy.kb.k_syms[i]));
            }
            Guppy.active_guppy.render(true);
            return false;
        }}(i));
    for(i in Guppy.kb.k_controls)
        Mousetrap.bind(i,function(i){ return function(){
            if(!Guppy.active_guppy) return true;
            // We want to skip using this control sequence only if there is an overriding text representation in Guppy.kb.k_text
            if(Utils.is_text(Guppy.active_guppy.engine.current) && Guppy.kb.k_text[i]){
                Guppy.active_guppy.engine.insert_string(Guppy.kb.k_text[i]);
            }
            else{
                Guppy.active_guppy.engine.space_caret = 0;
                Guppy.active_guppy.engine[Guppy.kb.k_controls[i]]();
                Guppy.active_guppy.temp_cursor.node = null;
            }
            Guppy.active_guppy.render(["up","down","right","left","home","end","sel_left","sel_right"].indexOf(i) < 0);
            //Guppy.active_guppy.render(false);
            return false;
        }}(i));
    for(i in Guppy.kb.k_text)
        if(!(Guppy.kb.k_chars[i] || Guppy.kb.k_syms[i] || Guppy.kb.k_controls[i])){
            Mousetrap.bind(i,function(i){ return function(){
                if(!Guppy.active_guppy) return true;
                Guppy.active_guppy.temp_cursor.node = null;
                if(Utils.is_text(Guppy.active_guppy.engine.current)){
                    Guppy.active_guppy.engine.insert_string(Guppy.kb.k_text[i]);
                    Guppy.active_guppy.render(true);
                }
                return false;
            }}(i));
        }
}

module.exports = Guppy;
