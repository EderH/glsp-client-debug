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
import {
    Action,
    CommandExecutionContext,
    CommandReturn,
    SModelElement,
    SModelRoot,
    SystemCommand,
    TYPES
} from "sprotty/lib";

import { SModelRootListener } from "../../base/model/update-model-command";
import { hasBreakpointFeature } from "./model";


export class EnableBreakpointAction implements Action {
    static readonly KIND = 'enableBreakpoint';
    kind = EnableBreakpointAction.KIND;
    constructor(readonly selectedElements: SModelElement[]) { }
}

export class DisableBreakpointAction implements Action {
    static readonly KIND = 'disableBreakpoint';
    kind = DisableBreakpointAction.KIND;
    constructor(readonly selectedElements: SModelElement[]) { }
}

@injectable()
export class EnableBreakpointCommand extends SystemCommand {
    static readonly KIND = EnableBreakpointAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: EnableBreakpointAction
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
export class DisableBreakpointCommand extends SystemCommand {
    static readonly KIND = DisableBreakpointAction.KIND;

    constructor(
        @inject(TYPES.Action) public action: DisableBreakpointAction,
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
export class RestoreBreakpoints implements SModelRootListener {

    private elements: SModelElement[];

    constructor(
    ) { }

    addElements(selectedElement: SModelElement) {
        if (!this.elements.includes(selectedElement)) {
            this.elements.push(selectedElement);
        }
    }

    removeElements(selectedElement: SModelElement) {
        const index = this.elements.indexOf(selectedElement);
        if (index > -1) {
            this.elements.splice(index);
        }
    }

    modelRootChanged(root: Readonly<SModelRoot>): void {

    }

}
