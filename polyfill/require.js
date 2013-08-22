/**
 * Copyright 2013 Facebook, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @provides commonjs-require
 * @requires Function.prototype
 * @polyfill
 */

(function(global) {

  // avoid redefining require()
  if (global.require) {
    return;
  }

  var toString = Object.prototype.toString;

      /**
      * module index: {
      *   mod1: {
      *     exports: { ... },
      *     id: 'mod1',
      *     dependencies: ['mod1', 'mod2'],
      *     factory: function() { ... },
      *     waitingMap: { mod1: 1, mod3: 1, mod4: 1 },
      *     waiting: 2
      *   }
      * }
      */
  var modulesMap = {},
      /**
      * inverse index: {
      *   mod1: [modules, waiting for mod1],
      *   mod2: [modules, waiting for mod2]
      * }
      */
      dependencyMap = {},
      /**
      * modules whose reference counts are set out of order
      */
      predefinedRefCounts = {},

      _counter = 0,

      REQUIRE_WHEN_READY = 1,
      USED_AS_TRANSPORT  = 2,

      hop = Object.prototype.hasOwnProperty;

  if (__DEV__) {
    function _findUnresolvedDependencies(names) {
      var unresolved = Array.prototype.slice.call(names);
      var visited = {};

      while (unresolved.length) {
        var name = unresolved.shift();
        if (visited[name]) {
          continue;
        }
        visited[name] = true;

        var module = modulesMap[name];
        if (!module || !module.waiting) {
          continue;
        }

        for (var ii = 0; ii < module.dependencies.length; ii++) {
          var dependency = module.dependencies[ii];
          if (!modulesMap[dependency] || modulesMap[dependency].waiting) {
            unresolved.push(dependency);
          }
        }
      }

      for (name in visited) if (hop.call(visited, name)) {
        unresolved.push(name);
      }
      return unresolved;
    }

    function _formatUnresolvedDependencies(unresolved) {
      var messages = [];
      for (var ii = 0; ii < unresolved.length; ii++) {
        var name = unresolved[ii];
        var message = name;
        var module = modulesMap[name];
        if (!module) {
          message += ' is not defined';
        } else if (!module.waiting) {
          message += ' is ready';
        } else {
          var unresolvedDependencies = [];
          for (var jj = 0; jj < module.dependencies.length; jj++) {
            var dependency = module.dependencies[jj];
            if (!modulesMap[dependency] || modulesMap[dependency].waiting) {
              unresolvedDependencies.push(dependency);
            }
          }
          message += ' is waiting for ' + unresolvedDependencies.join(', ');
        }
        messages.push(message);
      }
      return messages.join('\n');
    }
  }

  /**
  * The require function conforming to CommonJS spec:
  * http://wiki.commonjs.org/wiki/Modules/1.1.1
  *
  * To define a CommonJS-compliant module add the providesModule
  * Haste header to your file instead of @provides. Your file is going
  * to be executed in a separate context. Every variable/function you
  * define will be local (private) to that module. To export local members
  * use "exports" variable or return the exported value at the end of your
  * file. Your code will have access to the "module" object.
  * The "module" object will have an "id" property that is the id of your
  * current module. "module" object will also have "exports" property that
  * is the same as "exports" variable passed into your module context.
  * You can require other modules using their ids.
  *
  * Haste will automatically pick dependencies from require() calls. So
  * you don't have to manually specify @requires in your header.
  *
  * You cannot require() modules from non-CommonJS files. Write a legacy stub
  * (@providesLegacy) and use @requires instead.
  *
  * @example
  *
  *   / **
  *    * @providesModule math
  *    * /
  *   exports.add = function() {
  *     var sum = 0, i = 0, args = arguments, l = args.length;
  *     while (i < l) {
  *       sum += args[i++];
  *     }
  *     return sum;
  *   };
  *
  *   / **
  *    * @providesModule increment
  *    * /
  *   var add = require('math').add;
  *   return function(val) {
  *     return add(val, 1);
  *   };
  *
  *   / **
  *    * @providesModule program
  *    * /
  *   var inc = require('increment');
  *   var a = 1;
  *   inc(a); // 2
  *
  *   module.id == "program";
  *
  *
  * @param {String} id
  * @throws when module is not loaded or not ready to be required
  */
  function require(id) {
    if (global.ErrorUtils && !global.ErrorUtils.inGuard()) {
      return ErrorUtils.applyWithGuard(require, this, arguments);
    }

    var module = modulesMap[id],
        dep, i, msg;

    if (!modulesMap[id]) {
      msg = 'Requiring unknown module "' + id + '"';
      if (__DEV__) {
        msg += '. It may not be loaded yet. Did you forget to run arc build?';
      }
      throw new Error(msg);
    }

    if (module.hasError) {
      throw new Error(
        'Requiring module "' + id + '" which threw an exception');
    }

    if (module.waiting) {
      msg = 'Requiring module "' + id + '" with unresolved dependencies';
      if (__DEV__) {
        var unresolved = _findUnresolvedDependencies([id]);
        if (global.console) {
          global.console.error(_formatUnresolvedDependencies(unresolved));
        }
        var undefinedModules = [];
        for (var ii = 0; ii < unresolved.length; ii++) {
          var dependency = unresolved[ii];
          if (!modulesMap[dependency]) {
            undefinedModules.push(dependency);
          }
        }
        msg += ': ' + undefinedModules.join(', ');
      }
      throw new Error(msg);
    }

    if (!module.exports) {
      var exports = module.exports = {};
      var factory = module.factory;

      if (toString.call(factory) === '[object Function]') {

        var args = [],
            dependencies = module.dependencies,
            length = dependencies.length,
            ret;
        if (module.special & USED_AS_TRANSPORT) {
          length = Math.min(length, factory.length);
        }
        try {
          for (i = 0; i < length; i++) {
            dep = dependencies[i];
            args.push(dep  === 'module'  ? module  :
                      (dep === 'exports' ? exports : require(dep)));
          }
          ret = factory.apply(module.context || global, args);
        } catch (e) {
          module.hasError = true;
          throw e;
        }
        if (ret) {
          if (__DEV__) {
            if (typeof ret != 'object' && typeof ret != 'function') {
              throw new Error(
                'Factory for module "' + id + '" returned ' +
                'an invalid value "' + ret + '". ' +
                'Returned value should be either a function or an object.');
            }
          }
          module.exports = ret;
        }
      } else {
        module.exports = factory;
      }
    }

    // If ref count is 1, this was the last call, so undefine the module.
    // The ref count can be null or undefined, but those are never === 1.
    if (module.refcount-- === 1) {
      delete modulesMap[id];
    }

    return module.exports;
  }

  /**
  * The define function conforming to CommonJS proposal:
  * http://wiki.commonjs.org/wiki/Modules/AsynchronousDefinition
  *
  * define() allows you to explicitly state dependencies of your module
  * in javascript. It's most useful in non-CommonJS files.
  *
  * define() is used internally by haste as a transport for CommonJS
  * modules. So there's no need to use define() if you use providesModule
  *
  * @example
  *   / **
  *    * @provides alpha
  *    * /
  *
  *   // Sets up the module with ID of "alpha", that uses require,
  *   // exports and the module with ID of "beta":
  *   define("alpha", ["require", "exports", "beta"],
  *     function (require, exports, beta) {
  *     exports.verb = function() {
  *       return beta.verb();
  *       //Or:
  *       return require("beta").verb();
  *     }
  *   });
  *
  *   / **
  *    * @provides alpha
  *    * /
  *   // An anonymous module could be defined (module id derived from filename)
  *   // that returns an object literal:
  *
  *   define(["alpha"], function (alpha) {
  *      return {
  *        verb: function(){
  *          return alpha.verb() + 2;
  *        }
  *      };
  *   });
  *
  *   / **
  *    * @provides alpha
  *    * /
  *   // A dependency-free module can define a direct object literal:
  *
  *   define({
  *     add: function(x, y){
  *       return x + y;
  *     }
  *   });
  *
  * @param {String} id optional
  * @param {Array} dependencies optional
  * @param {Object|Function} factory
  */
  function define(id, dependencies, factory, _special, _context, _refCount) {
    if (dependencies === undefined) {
      dependencies = [];
      factory = id;
      id = _uid();
    } else if (factory === undefined) {
      factory = dependencies;
      if (toString.call(id) === '[object Array]') {
        dependencies = id;
        id = _uid();
      } else {
        dependencies = [];
      }
    }

    // Non-standard: we allow modules to be undefined. This is designed for
    // temporary modules.
    var canceler = { cancel: _undefine.bind(this, id) };

    var record = modulesMap[id];

    // Nonstandard hack: we call define with null deps and factory, but a
    // non-null reference count (e.g. define('name', null, null, 0, null, 4))
    // when this module is defined elsewhere and we just need to update the
    // reference count. We use this hack to avoid having to expose another
    // global function to increment ref counts.
    if (record) {
      if (_refCount) {
        record.refcount += _refCount;
      }
      // Calling define() on a pre-existing module does not redefine it
      return canceler;
    } else if (!dependencies && !factory && _refCount) {
      // If this module hasn't been defined yet, store the ref count. We'll use
      // it when the module is defined later.
      predefinedRefCounts[id] = (predefinedRefCounts[id] || 0) + _refCount;
      return canceler;
    } else {
      // Defining a new module
      record = { id: id };
      record.refcount = (predefinedRefCounts[id] || 0) + (_refCount || 0);
      delete predefinedRefCounts[id];
    }

    if (__DEV__) {
      if (
        !factory ||
        (typeof factory != 'object' && typeof factory != 'function' &&
         typeof factory != 'string')) {
        throw new Error(
          'Invalid factory "' + factory + '" for module "' + id + '". ' +
          'Factory should be either a function or an object.');
      }

      if (toString.call(dependencies) !== '[object Array]') {
        throw new Error(
          'Invalid dependencies for module "' + id + '". ' +
          'Dependencies must be passed as an array.');
      }
    }

    record.factory = factory;
    record.dependencies = dependencies;
    record.context = _context;
    record.special = _special;
    record.waitingMap = {};
    record.waiting = 0;
    record.hasError = false;
    modulesMap[id] = record;
    _initDependencies(id);

    return canceler;
  }

  function _undefine(id) {
    if (!modulesMap[id]) {
      return;
    }

    var module = modulesMap[id];
    delete modulesMap[id];

    for (var dep in module.waitingMap) {
      if (module.waitingMap[dep]) {
        delete dependencyMap[dep][id];
      }
    }

    for (var ii = 0; ii < module.dependencies.length; ii++) {
      dep = module.dependencies[ii];
      if (modulesMap[dep]) {
        if (modulesMap[dep].refcount-- === 1) {
          _undefine(dep);
        }
      } else if (predefinedRefCounts[dep]) {
        predefinedRefCounts[dep]--;
      }
      // Subtle: we won't account for this one fewer reference if we don't have
      // the dependency's definition or reference count yet.
    }
  }

  /**
   * Special version of define that executes the factory as soon as all
   * dependencies are met.
   *
   * define() does just that, defines a module. Module's factory will not be
   * called until required by other module. This makes sense for most of our
   * library modules: we do not want to execute the factory unless it's being
   * used by someone.
   *
   * On the other hand there are modules, that you can call "entrance points".
   * You want to run the "factory" method for them as soon as all dependencies
   * are met.
   *
   * @example
   *
   *   define('BaseClass', [], function() { return ... });
   *   // ^^ factory for BaseClass was just stored in modulesMap
   *
   *   define('SubClass', ['BaseClass'], function() { ... });
   *   // SubClass module is marked as ready (waiting == 0), factory is just
   *   // stored
   *
   *   define('OtherClass, ['BaseClass'], function() { ... });
   *   // OtherClass module is marked as ready (waiting == 0), factory is just
   *   // stored
   *
   *   requireLazy(['SubClass', 'ChatConfig'],
   *     function() { ... });
   *   // ChatRunner is waiting for ChatConfig to come
   *
   *   define('ChatConfig', [], { foo: 'bar' });
   *   // at this point ChatRunner is marked as ready, and its factory
   *   // executed + all dependent factories are executed too: BaseClass,
   *   // SubClass, ChatConfig notice that OtherClass's factory won't be
   *   // executed unless explicitly required by someone
   *
   * @param {Array} dependencies
   * @param {Object|Function} factory
   */
  function requireLazy(dependencies, factory, context) {
    return define(
      dependencies,
      factory,
      undefined,
      REQUIRE_WHEN_READY,
      context,
      1
    );
  }

  function _uid() {
    return '__mod__' + _counter++;
  }

  function _addDependency(module, dep) {
    // do not add duplicate dependencies and circ deps
    if (!module.waitingMap[dep] && module.id !== dep) {
      module.waiting++;
      module.waitingMap[dep] = 1;
      dependencyMap[dep] || (dependencyMap[dep] = {});
      dependencyMap[dep][module.id] = 1;
    }
  }

  function _initDependencies(id) {
    var modulesToRequire = [];
    var module = modulesMap[id];
    var dep, i, subdep;

    // initialize id's waitingMap
    for (i = 0; i < module.dependencies.length; i++) {
      dep = module.dependencies[i];
      if (!modulesMap[dep]) {
        _addDependency(module, dep);
      } else if (modulesMap[dep].waiting) {
        for (subdep in modulesMap[dep].waitingMap) {
          if (modulesMap[dep].waitingMap[subdep]) {
            _addDependency(module, subdep);
          }
        }
      }
    }
    if (module.waiting === 0 && module.special & REQUIRE_WHEN_READY) {
      modulesToRequire.push(id);
    }

    // update modules depending on id
    if (dependencyMap[id]) {
      var deps = dependencyMap[id];
      var submodule;
      dependencyMap[id] = undefined;
      for (dep in deps) {
        submodule = modulesMap[dep];

        // add all deps of id
        for (subdep in module.waitingMap) {
          if (module.waitingMap[subdep]) {
            _addDependency(submodule, subdep);
          }
        }
        // remove id itself
        if (submodule.waitingMap[id]) {
          submodule.waitingMap[id] = undefined;
          submodule.waiting--;
        }
        if (submodule.waiting === 0 &&
            submodule.special & REQUIRE_WHEN_READY) {
          modulesToRequire.push(dep);
        }
      }
    }

    // run everything that's ready
    for (i = 0; i < modulesToRequire.length; i++) {
      require(modulesToRequire[i]);
    }
  }

  function _register(id, exports) {
    modulesMap[id] = { id: id };
    modulesMap[id].exports = exports;
  }

  // pseudo name used in common-require
  // see require() function for more info
  _register('module', 0);
  _register('exports', 0);

  _register('define', define);
  _register('global', global);
  _register('require', require);
  _register('requireDynamic', require);
  _register('requireLazy', requireLazy);

  define.amd = {};

  global.define = define;
  global.require = require;
  global.requireDynamic = require;
  global.requireLazy = requireLazy;

  require.__debug = { modules: modulesMap, deps: dependencyMap };

  // shortcuts for haste transport
  var defineHaste = function(id, deps, factory, _special) {
    define(id, deps, factory, _special || USED_AS_TRANSPORT);
  };

  /**
   * All @providesModule files are wrapped by this function by makehaste. It
   * is a convenience function around define() that prepends a bunch of required
   * modules (global, require, module, etc) so that we don't have to spit that
   * out for every module which would be a lot of extra bytes.
   */
  global.__d = function(id, deps, factory, _special) {
    deps = ['global', 'require', 'requireDynamic', 'requireLazy', 'module',
            'exports'].concat(deps);
    defineHaste(id, deps, factory, _special);
  };

})(this);