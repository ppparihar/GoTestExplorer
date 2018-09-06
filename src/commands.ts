import { EventEmitter, Event } from "vscode";
import { TestNode } from "./testNode";

export class Commands {

    private onTestDiscoveryFinishedEmitter = new EventEmitter<TestNode[]>();
    

    public get discoveredTest() :Event<TestNode[]>{
        return this.onTestDiscoveryFinishedEmitter.event;
    }
    public  sendDiscoveredTest(testNodeList :TestNode[]){
        this.onTestDiscoveryFinishedEmitter.fire(testNodeList)
        
    }
}
