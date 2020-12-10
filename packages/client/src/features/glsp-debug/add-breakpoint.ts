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

import { hasBreakpointFeature } from "./model";

export class AddBreakpointAction implements Action {
    static readonly KIND = 'addBreakpoint';
    kind = AddBreakpointAction.KIND;
    constructor(readonly selectedElements: SModelElement[]) { }
}

export class RemoveBreakpointAction implements Action {
    static readonly KIND = 'removeBreakpoint';
    kind = RemoveBreakpointAction.KIND;
    constructor(readonly selectedElements: SModelElement[]) { }
}

@injectable()
export class AddBreakpointCommand extends SystemCommand {
    static readonly KIND = AddBreakpointAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: AddBreakpointAction,
    ) {
        super();
    }
    execute(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        for (const selectedElement of this.action.selectedElements) {
            const element = index.getById(selectedElement.id);
            if (element && hasBreakpointFeature(element)) {
                element.breakpoint = true;
            }
        }
        return context.root;
    }

    undo(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        for (const selectedElement of this.action.selectedElements) {
            const element = index.getById(selectedElement.id);
            if (element && hasBreakpointFeature(element)) {
                element.breakpoint = false;
            }
        }
        return context.root;
    }

    redo(context: CommandExecutionContext): CommandReturn {
        return this.execute(context);
    }
}


@injectable()
export class RemoveBreakpointCommand extends SystemCommand {
    static readonly KIND = RemoveBreakpointAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: RemoveBreakpointAction,
    ) {
        super();
    }
    execute(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        for (const selectedElement of this.action.selectedElements) {
            const element = index.getById(selectedElement.id);
            if (element && hasBreakpointFeature(element)) {
                element.breakpoint = false;
            }
        }
        return context.root;
    }

    undo(context: CommandExecutionContext): CommandReturn {
        const index = context.root.index;
        for (const selectedElement of this.action.selectedElements) {
            const element = index.getById(selectedElement.id);
            if (element && hasBreakpointFeature(element)) {
                element.breakpoint = true;
            }
        }
        return context.root;
    }

    redo(context: CommandExecutionContext): CommandReturn {
        return this.execute(context);
    }
}

@injectable()
export class BreakpointDecorator implements IVNodePostprocessor {

    decorate(vnode: VNode, element: SModelElement): VNode {
        if (hasBreakpointFeature(element) && element.breakpoint) {
            setClass(vnode, 'breakpoint', true);
        }
        return vnode;
    }

    postUpdate(): void {
    }
}











