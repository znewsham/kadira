function wrapConnectHandlers(rawOrNot) {
  const oldConnectHandlerUse = WebApp[rawOrNot].use;
  WebApp[rawOrNot].use = function use(route, fn) {
    const wrappedFn = Meteor.bindEnvironment(function(request, response, next) {
      const kadiraInfo = {
        userId: null,
        sessionId: null,
        trace: Kadira.tracer.start(
          { id: null, userId: null },
          { id: 0, msg: "method", method: `${rawOrNot}::${route}`}
        )
      };
      Kadira._setInfo(kadiraInfo);
      Kadira.tracer.event(kadiraInfo.trace, 'start', {
        userId: null,
        params: JSON.stringify([
          request.originalUrl,
          request.headers
        ])
      });
      const waitEventId = Kadira.tracer.event(kadiraInfo.trace, 'wait', {}, kadiraInfo);

      const requestOn = request.on;
      request.on = Meteor.bindEnvironment(function(type, callback) {
        if (type == "end") {
          requestOn.call(request, type, Meteor.bindEnvironment(function(...args) {
            Kadira._setInfo(kadiraInfo);
            Kadira.tracer.eventEnd(kadiraInfo.trace, waitEventId, {waitOn: []});
            callback.call(this, ...args)
          }));
        }
        else {
          requestOn.call(request, type, callback);
        }
      });
      const responseEnd = response.end;
      function finished() {
        kadiraInfo.trace.outlier = true;
        var trace = Kadira.tracer.buildTrace(kadiraInfo.trace);
        Kadira.models.methods.processMethod(trace);
        if(error && Kadira.options.enableErrorTracking) {
          Kadira.models.error.trackError(error, trace);
        }
      };
      response.end = function(...args) {
        Kadira.tracer.endLastEvent(kadiraInfo.trace);
        Kadira.tracer.event(kadiraInfo.trace, 'complete');
        finished();
        responseEnd.call(this, ...args);
      };

      let error;
      try {
        fn.call(this, request, response, Meteor.bindEnvironment(next));
      }
      catch (e) {
        error = _.pick(e, ['message', 'stack']);
        // see wrapMethodHanderForErrors() method def for more info
        if(error.stack && error.stack.stack) {
          error.stack = error.stack.stack;
        }

        Kadira.tracer.endLastEvent(kadiraInfo.trace);
        Kadira.tracer.event(kadiraInfo.trace, 'error', {error: error});
        finished();
      }
    });

    // for safety, we DONT wrap any unnamed routes (e.g., the one meteor defines for us)
    if (route && route !== "/") {
      oldConnectHandlerUse.call(this, route, wrappedFn);
    }
    else {
      oldConnectHandlerUse.call(this, route, fn);
    }
  };
}
