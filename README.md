# Welcome to Go Test Explorer Extension

## What's in the folder
* This folder contains all of the files necessary for Go Test Explorer Extension.
* `package.json` - this is the manifest file in which you declare Go Test Explorer Extension and command.
* `src/extension.ts` - this is the main file where you will provide the implementation of your command.
The file exports one function, `activate`, which is called the very first time Go Test Explorer Extension is
activated (in this case by executing the command). Inside the `activate` function we call `registerCommand`.
We pass the function containing the implementation of the command as the second parameter to
`registerCommand`.

## Get up and running straight away
* Press `F5` to open a new window with Go Test Explorer Extension loaded.
* Set breakpoints in your code inside `src/extension.ts` to debug Go Test Explorer Extension.
* Find output from Go Test Explorer Extension in the debug console.

## Run tests
* Open the debug viewlet (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac) and from the launch configuration dropdown pick `Launch Tests`.
* Press `F5` to run the tests in a new window with Go Test Explorer Extension loaded.
* See the output of the test result in the debug console.
* Make changes to `test/extension.test.ts` or create new test files inside the `test` folder.
    * By convention, the test runner will only consider files matching the name pattern `**.test.ts`.
    * You can create folders inside the `test` folder to structure your tests any way you want.
