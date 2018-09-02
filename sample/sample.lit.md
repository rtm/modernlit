---
title: Hello World
verbose: true
---

# Hello World in `modernlit`

"Hello world" is a simple web application.
Let's see how it can be written in `modernlit`,
the new literate programming environment for the web.

## The main HTML file `index.html`

We'll start with the HTML file:

##### >index.html
```html
<html>
  <!-- <<HTML head section>> -->
  <body>
    <span id="hello">Hello, world.</span>
  </body>
</html>
```

The <span class="ml-comment-link no-icon" data-index="4">HTML head section</span> in the code above
indicates that we will fill this in later.
Click on the link to visit the place in the document where it's defined.

The `>` in `>index.html` indicates that this is a file to be written out.

## Styling the output with CSS

For this toy application, our CSS simply styles the "Hello, world" text,
using its ID:

##### >index.css
```css
#hello {
  color: purple;
}
```

## Handling clicks

We want to handle a click on the "Hello, World" text.
To do that, we set up an event listener with `addEventListener`.

##### Define handler for click on text
```js
  document.getElementById("hello").addEventListener("click", () => alert("clicked"));
 ```

## The `head` part of the HTML file

Finally, let us come back to the head section of the HTML file.

##### HTML head section
```html
<head>
  <script src="./index.js"></script>
  <link rel="stylesheet" href="./index.css">
</head>
```

## The JavaScript file

The actual JS we include in this page needs to be wrapped in an event listener to be invoked when the DOM has loaded:

##### >index.js
```js
document.addEventListener("DOMContentLoaded", function(event) {
  // <<Define handler for click on text>>
});

```

## Module overview

Here's a summary of all the fragments making up the app, and a picture of how they interrelate.


### Graph

Each module points to other modules which it uses.

[[GRAPH]]

### List of Fragments

[[LOF]]
