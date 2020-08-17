/********************************************************************************
 * Copyright (c) 2019 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { inject, injectable } from "inversify";
import { VNode } from "snabbdom/vnode";
import {
    Action,
    CommandExecutionContext,
    CommandReturn,
    IVNodePostprocessor,
    setClass,
    SModelElement,
    SystemCommand,
    TYPES
} from "sprotty/lib";

import { hasStackFrameFeature, StackFrameElement } from "./model";


export class AnnotateStackAction implements Action {
    static readonly KIND = 'annotateStack';
    kind = AnnotateStackAction.KIND;
    constructor(readonly elementID: string) { }
}

export class ClearStackAnnotationAction implements Action {
    static readonly KIND = 'clearStackAnnotation';
    kind = ClearStackAnnotationAction.KIND;
    constructor(readonly elementID: string) { }
}

export class ResolvedAnnotateStack {
    element: StackFrameElement;
}

@injectable()
export class AnnotateStackCommand extends SystemCommand {

    static readonly KIND = AnnotateStackAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: AnnotateStackAction
    ) {
        super();
    }

    resolvedAnnotateStack: ResolvedAnnotateStack;

    execute(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        const element = index.getById(this.action.elementID);
        if (element && hasStackFrameFeature(element)) {
            element.current = true;
            this.resolvedAnnotateStack = { element };
        }
        return context.root;
    }

    undo(context: CommandExecutionContext): CommandReturn {
        if (this.resolvedAnnotateStack) {
            this.resolvedAnnotateStack.element.current = !this.resolvedAnnotateStack.element.current;
        }
        return context.root;
    }

    redo(context: CommandExecutionContext): CommandReturn {
        return this.execute(context);
    }

}

@injectable()
export class ClearStackAnnotationCommand extends SystemCommand {

    static readonly KIND = ClearStackAnnotationAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: ClearStackAnnotationAction
    ) {
        super();
    }

    resolvedSetStackFrame: ResolvedAnnotateStack;

    execute(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        const element = index.getById(this.action.elementID);
        if (element && hasStackFrameFeature(element)) {
            element.current = false;
            this.resolvedSetStackFrame = { element };
        }
        return context.root;
    }

    undo(context: CommandExecutionContext): CommandReturn {
        if (this.resolvedSetStackFrame) {
            this.resolvedSetStackFrame.element.current = !this.resolvedSetStackFrame.element.current;
        }
        return context.root;
    }

    redo(context: CommandExecutionContext): CommandReturn {
        return this.execute(context);
    }

}

@injectable()
export class StackFrameDecorator implements IVNodePostprocessor {

    decorate(vnode: VNode, element: SModelElement): VNode {
        if (hasStackFrameFeature(element) && element.current) {
            setClass(vnode, 'current', true);
        }
        return vnode;
    }

    postUpdate(): void {
    }
}
