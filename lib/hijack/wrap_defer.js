
function withoutInvocation(f) {
  if (Package.ddp) {
    var DDP = Package.ddp.DDP;
    var CurrentInvocation =
      DDP._CurrentMethodInvocation ||
      // For backwards compatibility, as explained in this issue:
      // https://github.com/meteor/meteor/issues/8947
      DDP._CurrentInvocation;

    var invocation = CurrentInvocation.get();
    if (invocation && invocation.isSimulation) {
      throw new Error("Can't set timers inside simulations");
    }

    return function () {
      CurrentInvocation.withValue(null, f);
    };
  } else {
    return f;
  }
}

function bindAndCatch(context, f) {
  return Meteor.bindEnvironment(withoutInvocation(f), context);
}
Meteor.defer = function defer(f) {
  const preKadiraInfo = Kadira._getInfo();
  let postKadiraInfo;
  let waitEventId;
  const onException = function onException(error) {
    Meteor._debug(
      "Exception in defer:",
      error && error.stack || error
    );
  };
  if (preKadiraInfo && preKadiraInfo.trace) {
    postKadiraInfo = {
      userId: preKadiraInfo.userId,
      sessionId: preKadiraInfo.sessionId,
      trace: Kadira.tracer.start(
        { id: preKadiraInfo.sessionId, userId: preKadiraInfo.userId },
        { id: preKadiraInfo.trace.id, msg: preKadiraInfo.trace.type, [preKadiraInfo.trace.type === "sub" ? "name" : "method"]: preKadiraInfo.trace.name + "::deferred" }
      )
    };
    Kadira.tracer.event(postKadiraInfo.trace, 'start', preKadiraInfo.trace.events[0].data);
    waitEventId = Kadira.tracer.event(postKadiraInfo.trace, 'wait', {}, postKadiraInfo);
  }
  const _f = function() {
    if (postKadiraInfo) {
      Kadira.tracer.eventEnd(postKadiraInfo.trace, waitEventId, {waitOn: []});
      Kadira._setInfo(postKadiraInfo);
    }
    let error;
    try {
      f();
      if (postKadiraInfo) {
        Kadira.tracer.event(postKadiraInfo.trace, 'complete');
      }
    }
    catch (e) {
      if (postKadiraInfo) {
        // the error stack is wrapped so Meteor._debug can identify
        // this as a method error.
        error = _.pick(e, ['message', 'stack']);
        // see wrapMethodHanderForErrors() method def for more info
        if(error.stack && error.stack.stack) {
          error.stack = error.stack.stack;
        }

        Kadira.tracer.endLastEvent(postKadiraInfo.trace);
        Kadira.tracer.event(postKadiraInfo.trace, 'error', {error: error});
      }
      throw e;
    }
    finally {
      if (postKadiraInfo) {
        var trace = Kadira.tracer.buildTrace(postKadiraInfo.trace);
        if (postKadiraInfo.trace.type === "method") {
          Kadira.models.methods.processMethod(trace);
        }
        else if (postKadiraInfo.trace.type === "sub") {
          Kadira.models.pubsub.processMethod(trace);
        }
        if(error && Kadira.options.enableErrorTracking) {
          Kadira.models.error.trackError(error, trace);
        }
      }
    }
  }
  Meteor._setImmediate(bindAndCatch(onException, _f));
};
